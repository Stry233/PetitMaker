import { posix } from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';

const MIB = 1024 * 1024;
const FORBIDDEN_CALLS = /^(?:fetch|eval|Function|Worker|SharedWorker|WebSocket|EventSource|XMLHttpRequest|RTCPeerConnection|webkitRTCPeerConnection|Accelerometer|Gyroscope|Magnetometer|AmbientLightSensor|PaymentRequest|Notification)$/;
const FORBIDDEN_MEMBERS = /^(?:requestFullscreen|webkitRequestFullscreen|requestPointerLock|webkitRequestPointerLock|requestMIDIAccess|getDisplayMedia|enumerateDevices|getBattery|sendBeacon)$/;

function property(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${property(node.expression)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return `${property(node.expression)}.${node.argumentExpression.text}`;
  return '';
}

export function validateLiteScript(name: string, code: string): void {
  new Script(code, { filename: name });
  const file = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)
      || ts.isMetaProperty(node) || ts.isBigIntLiteral(node) || ts.isPrivateIdentifier(node)
      || ts.isSpreadAssignment(node) || ts.isClassStaticBlockDeclaration(node) || ts.isPropertyDeclaration(node)
      || ('questionDotToken' in node && node.questionDotToken)
      || (ts.isCatchClause(node) && !node.variableDeclaration)
      || (ts.isForOfStatement(node) && node.awaitModifier)
      || (ts.isBindingElement(node) && node.dotDotDotToken && ts.isObjectBindingPattern(node.parent))
      || (ts.isFunctionLike(node) && 'asteriskToken' in node && node.asteriskToken && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword))
      || (ts.isNumericLiteral(node) && node.getText(file).includes('_'))
      || (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken].includes(node.operatorToken.kind))) {
      throw new Error(`Unsupported syntax in ${name}: ${ts.SyntaxKind[node.kind]}`);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const path = property(node.expression);
      const key = path.split('.').pop() ?? '';
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || FORBIDDEN_CALLS.test(key) || FORBIDDEN_MEMBERS.test(key)
        || /^(?:window|globalThis|self)\.(?:open|prompt)$/.test(path)
        || /^(?:open|prompt)$/.test(path)
        || (/\.execCommand$/.test(path) && node.arguments?.some(arg => ts.isStringLiteral(arg) && /^(copy|cut|paste)$/.test(arg.text)))
        || (key === 'addEventListener' && node.arguments?.some(arg => ts.isStringLiteral(arg) && /^(devicemotion|deviceorientation)$/.test(arg.text)))) {
        throw new Error(`Unsupported API in ${name}: ${path}`);
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const path = property(node);
      if (/^(?:(?:window|globalThis|self)\.)?(?:WebAssembly|navigator\.(?:geolocation|clipboard|bluetooth|usb|hid|serial|connection|credentials|locks|serviceWorker|xr))\./.test(path)
        || /navigator\.storage\.persist$/.test(path)) throw new Error(`Unsupported API in ${name}: ${path}`);
    }
    if (ts.isRegularExpressionLiteral(node) && (/\\[pP]\{|\(\?</.test(node.text) || /\/[a-z]*[sdv][a-z]*$/i.test(node.text))) throw new Error(`Unsupported regex in ${name}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
}

export function validateLiteResources(entries: Record<string, Uint8Array>): string[] {
  const advisories: string[] = [];
  function resource(raw: string, name: string, memoryImage = false): void {
    if (raw.startsWith('#')) return;
    if (memoryImage && /^(?:data:image\/|blob:)/i.test(raw)) return;
    if (/^(?:[a-z][\w+.-]*:|\/|\\)/i.test(raw)) throw new Error(`Missing or non-local resource in ${name}: ${raw.slice(0, 100)}`);
    const pathname = decodeURIComponent(raw.split(/[?#]/)[0]!);
    const path = posix.normalize(posix.join(posix.dirname(name), pathname));
    if (!pathname || !entries[path]) throw new Error(`Missing or non-local resource in ${name}: ${raw}`);
  }
  function css(code: string, name: string): void {
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');
    if (/@import\b/i.test(code)) throw new Error(`Unsupported CSS import in ${name}`);
    for (const match of code.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) resource(match[2]!, name, !/data:font\//i.test(match[2]!));
  }
  for (const [name, bytes] of Object.entries(entries)) {
    if (!/\.(?:html|css|js|json|svg)$/.test(name)) continue;
    const text = new TextDecoder().decode(bytes);
    for (const match of text.matchAll(/data:[^,;]+;base64,([A-Za-z0-9+/=]+)/g)) {
      const size = Buffer.from(match[1]!, 'base64').length;
      if (size > MIB) throw new Error(`Oversized base64 in ${name}`);
      if (size > 100 * 1024) advisories.push(`${name} embeds base64 above 100 KiB`);
    }
    if (name.endsWith('.js')) validateLiteScript(name, text);
    if (name.endsWith('.css')) css(text, name);
    if (!/\.(html|svg)$/.test(name)) continue;
    const dom = new JSDOM(text, name.endsWith('.svg') ? { contentType: 'image/svg+xml' } : {});
    try {
      const doc = dom.window.document;
      for (const el of doc.querySelectorAll('*')) {
        const tag = el.tagName.toLowerCase();
        if (['base', 'iframe', 'object', 'embed'].includes(tag)) throw new Error(`Unsupported element in ${name}: ${tag}`);
        if (el.hasAttribute('download') || el.getAttribute('target') === '_blank') throw new Error(`Unsupported navigation in ${name}`);
        if ((tag === 'meta' && el.getAttribute('http-equiv')?.toLowerCase() === 'content-security-policy')
          || el.getAttribute('type')?.toLowerCase() === 'module' || el.getAttribute('rel')?.toLowerCase() === 'modulepreload') throw new Error('Lite requires classic scripts and container-owned CSP');
        if (tag === 'script' && (name.endsWith('.svg') || !el.getAttribute('src') || el.textContent?.trim())) throw new Error('Inline scripting is unsupported');
        for (const attr of el.attributes) {
          if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) throw new Error('Inline scripting is unsupported');
          if (['src', 'href', 'xlink:href', 'poster', 'action'].includes(attr.name)) resource(attr.value, name, (['img', 'image'].includes(tag) || (tag === 'link' && el.getAttribute('rel') === 'icon')));
          if (attr.name === 'srcset') throw new Error(`Unsupported responsive resource list in ${name}`);
          if (attr.name === 'style') css(attr.value, name);
        }
        if (tag === 'style') css(el.textContent ?? '', name);
      }
      if (name === 'index.html') {
        const viewport = doc.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
        if (!doc.doctype || !doc.documentElement.lang || !doc.querySelector('meta[charset]')
          || !['width=device-width', 'initial-scale=1', 'viewport-fit=cover'].every(value => viewport.includes(value))) throw new Error('Missing Lite entry metadata or viewport');
      }
    } finally { dom.window.close(); }
  }
  return [...new Set(advisories)];
}
