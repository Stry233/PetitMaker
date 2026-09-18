import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, extname } from 'node:path';
import ts from 'typescript';
import { Script } from 'node:vm';
import { zipSync } from 'fflate';
import { resolveBuildInfo, resolveVersion } from './build-info-core.mts';

const root = 'dist-lite';
const allowed = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json']);
const entries: Record<string, Uint8Array> = {};
function collect(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { collect(path); continue; }
    const name = relative(root, path).replaceAll('\\', '/');
    if (!allowed.has(extname(name))) throw new Error(`Unsupported Lite file: ${name}`);
    if (/worker|onnx|tesseract|tensorflow|neural/i.test(name)) throw new Error(`Unsupported Lite runtime: ${name}`);
    entries[name] = readFileSync(path);
  }
}
collect(root);
if (Object.keys(entries).filter(name => name.endsWith('.html')).join() !== 'index.html') throw new Error('Lite requires exactly one index.html');
const html = readFileSync(join(root, 'index.html'), 'utf8');
if (/<script\b(?![^>]*\bsrc=)/i.test(html) || /\bon\w+=|javascript:/i.test(html)) throw new Error('Inline scripting is unsupported');
if (/type=["']module|Content-Security-Policy|rel=["']modulepreload/i.test(html)) throw new Error('Lite requires classic scripts and container-owned CSP');
for (const [name, bytes] of Object.entries(entries)) {
  if (!name.endsWith('.js')) continue;
  const code = new TextDecoder().decode(bytes);
  new Script(code, { filename: name });
  const file = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)
      || ts.isMetaProperty(node) || ts.isBigIntLiteral(node) || ts.isPrivateIdentifier(node)
      || ts.isSpreadAssignment(node) || ('questionDotToken' in node && node.questionDotToken)
      || (ts.isCatchClause(node) && !node.variableDeclaration)) throw new Error(`Unsupported syntax in ${name}: ${ts.SyntaxKind[node.kind]}`);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = node.expression;
      const key = ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) ? target.name.text : '';
      if (target.kind === ts.SyntaxKind.ImportKeyword || /^(?:fetch|eval|Function|Worker|SharedWorker|WebSocket|EventSource|XMLHttpRequest)$/.test(key)) throw new Error(`Unsupported API in ${name}: ${key}`);
    }
    if (ts.isRegularExpressionLiteral(node) && /\\[pP]\{|\(\?<[=!]/.test(node.text)) throw new Error(`Unsupported regex in ${name}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const match of code.matchAll(/data:[^,;]+;base64,([A-Za-z0-9+/=]+)/g)) if (Buffer.from(match[1]!, 'base64').length > 1048576) throw new Error(`Oversized base64 in ${name}`);
}
for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const url = match[1]!;
  if (url.startsWith('data:')) continue;
  if (!url.startsWith('./') || !entries[url.slice(2)]) throw new Error(`Missing or non-local entry resource: ${url}`);
}
let textBytes = 0;
for (const [name, bytes] of Object.entries(entries)) {
  if (!/\.(?:html|css|js|json)$/.test(name)) continue;
  textBytes += bytes.length;
  if (bytes.length > 2 * 1048576) console.warn(`Lite size advisory: ${name} exceeds 2 MiB uncompressed`);
}
if (textBytes > 5 * 1048576) console.warn('Lite size advisory: total text exceeds 5 MiB uncompressed');
const zip = zipSync(entries, { level: 6, mtime: new Date(1980, 0, 1) });
if (zip.length > 2 * 1048576) console.warn('Lite size advisory: ZIP exceeds the recommended 2 MiB');
if (zip.length > 10 * 1048576) throw new Error('Lite ZIP exceeds the 10 MiB upload limit');
const { info } = resolveBuildInfo({ readStamp: () => readFileSync('build-info.json', 'utf8') });
const version = resolveVersion({ pkgVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
  buildNumber: info.buildNumber, release: info.release, lastRelease: info.lastRelease }).replace(/-dev$/, '') + '-lite';
const sha256 = createHash('sha256').update(zip).digest('hex');
const filename = `petitmaker-${version}-${sha256.slice(0, 12)}.zip`;
const output = join('artifacts', 'lite');
mkdirSync(output, { recursive: true });
const path = join(output, filename);
if (existsSync(path)) {
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== sha256) throw new Error(`Lite artifact collision: ${path}`);
} else writeFileSync(path, zip, { flag: 'wx' });
const manifest = JSON.stringify({ filename, version, buildNumber: info.buildNumber, source: info.sha,
  sha256, bytes: zip.length, files: Object.keys(entries).length }, null, 2) + '\n';
writeFileSync(join(output, filename.replace(/\.zip$/, '.json')), manifest);
writeFileSync(join(output, 'latest.json'), manifest);
console.log(`PetitMaker Lite: ${Object.keys(entries).length} files, ${(zip.length / 1048576).toFixed(2)} MiB → ${path}`);
