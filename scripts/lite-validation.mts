import { posix } from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { DEFAULT_LITE_HOST, LITE_HOSTS, type LiteHostId } from '../src/platform/build/lite-hosts.ts';

const MIB = 1024 * 1024;

/** What a host's platform accepts in an uploaded package, beyond the content rules every Lite package keeps. */
export interface LitePackageRules {
  /** Most files the ZIP may hold; null where the platform states no count. */
  maxFiles: number | null;
  /** Largest ZIP the platform accepts, in bytes. */
  maxZipBytes: number;
  /** Largest entry `index.html` the platform accepts, uncompressed bytes; null where it states none. */
  maxEntryBytes: number | null;
  /** Whether `REMOTE_FOLDER` may hold only pictures. */
  picturesOnlyRemoteFolder: boolean;
  /** The platform's own size audit: past these it warns but accepts. */
  advisories: { fileTextBytes: number; totalTextBytes: number; zipBytes: number } | null;
  /** The folder below the site root the platform serves the package from; empty at the root. */
  servedFrom: string;
}

export const LITE_PACKAGE_RULES: Readonly<Record<LiteHostId, LitePackageRules>> = {
  // The 200-file count comes from an upload refusal, not the documentation.
  xhs: { maxFiles: 200, maxZipBytes: 10 * MIB, maxEntryBytes: null, picturesOnlyRemoteFolder: true, advisories: { fileTextBytes: 2 * MIB, totalTextBytes: 5 * MIB, zipBytes: 2 * MIB }, servedFrom: '' },
  // "50MB" read as decimal megabytes, the stricter reading; the entry limit is the one the Toy doctor applies.
  bilibili: { maxFiles: null, maxZipBytes: 50 * 1000 * 1000, maxEntryBytes: MIB, picturesOnlyRemoteFolder: false, advisories: null, servedFrom: 'toy/petitmaker' },
};

/** A byte limit as its rule states it. */
export const byteLimit = (bytes: number): string => (bytes % MIB === 0 ? `${bytes / MIB} MiB` : `${bytes / 1e6} MB`);
/** The folder the Xiaohongshu container may serve from afar (its static resource optimisation, client 9.53.3 and
 *  later); the entry page, scripts and stylesheets stay outside it, and what lands there may fail to load offline. */
export const REMOTE_FOLDER = 'assets/';
/** What may go in `REMOTE_FOLDER`. */
export const REMOTE_FILE = /\.(?:png|jpe?g|gif|webp|svg)$/i;
/** Every name the other hosts declare (`LiteHost.names`): each platform forbids naming another, so no
 *  package carries one, in any file or file name. */
export function otherPlatformNames(host: LiteHostId): string[] {
  return (Object.keys(LITE_HOSTS) as LiteHostId[]).filter((other) => other !== host).flatMap((other) => LITE_HOSTS[other].names);
}

/** Text as a reader meets it: `\uXXXX` escapes and the text a base64 data URI encodes read as their
 *  characters, and any other long base64 run, a picture's or an index's bytes, dropped, since it spells
 *  nothing and would otherwise spell a short name by chance. */
function readableText(text: string): string {
  return text
    .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/data:(?:image\/svg\+xml|text\/[\w.+-]+|application\/json)(?:;[\w.+-]+=[\w.+-]+)*;base64,([A-Za-z0-9+/]+=*)/gi,
      (_, data: string) => ` ${Buffer.from(data, 'base64').toString('utf8')} `)
    .replace(/[A-Za-z0-9+/]{100,}=*/g, ' ');
}

const WORD = /[A-Za-z0-9]/;
const UPPER = /[A-Z]/;
const LOWER = /[a-z]/;
/** Whether the Latin letters or digits `before` and `after` the match `found` run it on into a longer word,
 *  as in a file hash or a short identifier; a join where a lower-case letter meets a capital starts or ends
 *  a word, as in a longer identifier. A name in another script counts wherever it stands. */
const runsOn = (before: string, found: string, after: string): boolean => (
  (WORD.test(before) && WORD.test(found[0]!) && !(LOWER.test(before) && UPPER.test(found[0]!)))
  || (WORD.test(after) && WORD.test(found.at(-1)!) && !(LOWER.test(found.at(-1)!) && UPPER.test(after)))
);

/** The first of `names` that `text` carries, whatever its case, with the text around it; null where none. */
export function platformNameIn(text: string, names: readonly string[]): { name: string; context: string } | null {
  const readable = readableText(text);
  for (const name of names) {
    const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    for (const match of readable.matchAll(pattern)) {
      const at = match.index;
      if (runsOn(readable[at - 1] ?? '', match[0], readable[at + match[0].length] ?? '')) continue;
      return { name, context: readable.slice(Math.max(0, at - 40), at + match[0].length + 40).replace(/\s+/g, ' ') };
    }
  }
  return null;
}

/** Throws where `text`, the packaged file `file` or its name, names another host's platform. */
export function refuseOtherPlatforms(file: string, text: string, host: LiteHostId): void {
  const found = platformNameIn(text, otherPlatformNames(host));
  if (found) throw new Error(`${file} names another platform (${found.name}): ${found.context}`);
}

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
      || (ts.isBinaryExpression(node) && [
        ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
        ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
      ].includes(node.operatorToken.kind))) {
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

export function validateLiteResources(entries: Record<string, Uint8Array>, host: LiteHostId = DEFAULT_LITE_HOST): string[] {
  const advisories: string[] = [];
  const { sdkScript } = LITE_HOSTS[host];
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
    refuseOtherPlatforms(name, text, host);
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
        const sdk = name === 'index.html' && tag === 'script' && sdkScript !== null && el.getAttribute('src') === sdkScript;
        for (const attr of el.attributes) {
          if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) throw new Error('Inline scripting is unsupported');
          if (sdk && attr.name === 'src') continue;
          if (['src', 'href', 'xlink:href', 'poster', 'action'].includes(attr.name)) resource(attr.value, name, (['img', 'image'].includes(tag) || (tag === 'link' && el.getAttribute('rel') === 'icon')));
          if (attr.name === 'srcset') throw new Error(`Unsupported responsive resource list in ${name}`);
          if (attr.name === 'style') css(attr.value, name);
        }
        if (tag === 'style') css(el.textContent ?? '', name);
      }
      if (name === 'index.html') {
        const scripts = [...doc.querySelectorAll('script')].map(script => script.getAttribute('src'));
        if (sdkScript !== null && (scripts[0] !== sdkScript || scripts.filter(src => src === sdkScript).length !== 1)) {
          throw new Error(`The entry page must load the host SDK once, ahead of every other script: ${sdkScript}`);
        }
        const viewport = doc.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
        if (!doc.doctype || !doc.documentElement.lang || !doc.querySelector('meta[charset]')
          || !['width=device-width', 'initial-scale=1', 'viewport-fit=cover'].every(value => viewport.includes(value))) throw new Error('Missing Lite entry metadata or viewport');
      }
    } finally { dom.window.close(); }
  }
  return [...new Set(advisories)];
}
