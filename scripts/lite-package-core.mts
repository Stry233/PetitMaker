import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, extname } from 'node:path';
import { validateLiteResources } from './lite-validation.mts';
import { unzipSync, zipSync } from 'fflate';

const MIB = 1024 * 1024;
const MAX_FILES = 200;
const ALLOWED_EXTENSIONS = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.woff', '.woff2', '.json']);
export type LiteEntries = Record<string, Uint8Array>;

export function collectLiteFiles(root: string): LiteEntries {
  const entries: LiteEntries = {};
  function collect(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { collect(path); continue; }
      const name = relative(root, path).replaceAll('\\', '/');
      if (!entry.isFile()) throw new Error(`Unsupported Lite file: ${name}`);
      entries[name] = readFileSync(path);
    }
  }
  collect(root);
  return entries;
}

/** Validate the bytes that will be archived, independently of the build directory. */
export function validateLiteEntries(entries: LiteEntries): string[] {
  const files = Object.keys(entries).length;
  if (files > MAX_FILES) throw new Error(`Lite ZIP contains ${files} files, exceeding the ${MAX_FILES}-file upload limit`);
  for (const name of Object.keys(entries)) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '..' || part === '.')) {
      throw new Error(`Invalid Lite resource path: ${name}`);
    }
    if (name.split('/').some(part => part.startsWith('.') || part === 'node_modules') || /(?:^|\/)(?:vite|webpack)\.config\./.test(name)) throw new Error(`Unsupported Lite file: ${name}`);
    if (!ALLOWED_EXTENSIONS.has(extname(name))) throw new Error(`Unsupported Lite file: ${name}`);
    if (/worker|onnx|tesseract|tensorflow|neural/i.test(name)) throw new Error(`Unsupported Lite runtime: ${name}`);
  }
  if (Object.keys(entries).filter(name => name.endsWith('.html')).join() !== 'index.html') throw new Error('Lite requires exactly one index.html');
  return validateLiteResources(entries);
}

export interface LiteArchive {
  zip: Uint8Array;
  files: number;
  advisories: string[];
}

export function createLiteArchive(entries: LiteEntries): LiteArchive {
  const advisories = validateLiteEntries(entries);
  let textBytes = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!/\.(?:html|css|js|json)$/.test(name)) continue;
    textBytes += bytes.length;
    if (bytes.length > 2 * MIB) advisories.push(`${name} exceeds 2 MiB uncompressed`);
  }
  if (textBytes > 5 * MIB) advisories.push('total text exceeds 5 MiB uncompressed');
  // ZIP entry order and timestamps must not depend on the filesystem or build time.
  const ordered = Object.fromEntries(Object.keys(entries).sort().map(name => [name, entries[name]!]));
  const zip = zipSync(ordered, { level: 6, mtime: new Date(1980, 0, 1) });
  if (zip.length > 10 * MIB) throw new Error('Lite ZIP exceeds the 10 MiB upload limit');
  if (zip.length > 2 * MIB) advisories.push('ZIP exceeds the recommended 2 MiB');
  return { zip, files: Object.keys(entries).length, advisories };
}

interface LiteIdentity {
  version: string;
  buildNumber: string;
  source: string;
}

/** Existing archives are immutable; only the latest manifest advances on a new build. */
export function writeLiteArchive(output: string, archive: LiteArchive, identity: LiteIdentity): string {
  const sha256 = createHash('sha256').update(archive.zip).digest('hex');
  const filename = `petitmaker-${identity.version}-${sha256.slice(0, 12)}.zip`;
  const path = join(output, filename);
  mkdirSync(output, { recursive: true });
  if (existsSync(path)) {
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== sha256) {
      throw new Error(`Lite artifact collision: ${path}`);
    }
  } else writeFileSync(path, archive.zip, { flag: 'wx' });
  const manifest = JSON.stringify({ filename, ...identity, sha256, bytes: archive.zip.length, files: archive.files }, null, 2) + '\n';
  writeFileSync(join(output, filename.replace(/\.zip$/, '.json')), manifest);
  writeFileSync(join(output, 'latest.json'), manifest);
  return path;
}

/** Verify the stored archive itself before any consumer extracts or serves it. */
export function readLiteArtifact(output: string, expectedVersion?: string) {
  const manifest = JSON.parse(readFileSync(join(output, 'latest.json'), 'utf8'));
  if (!/^petitmaker-\d+\.\d+\.\d+-lite-[a-f0-9]{12}\.zip$/.test(manifest.filename)) throw new Error('Invalid Lite artifact filename');
  if (expectedVersion && manifest.version !== expectedVersion) throw new Error('Lite artifact does not match the publication version');
  const zipPath = join(output, manifest.filename);
  const zip = readFileSync(zipPath);
  if (zip.length > 10 * MIB) throw new Error('Lite ZIP exceeds the 10 MiB upload limit');
  const sha256 = createHash('sha256').update(zip).digest('hex');
  if (sha256 !== manifest.sha256 || zip.length !== manifest.bytes
    || manifest.filename !== `petitmaker-${manifest.version}-${sha256.slice(0, 12)}.zip`) throw new Error('Lite artifact checksum or identity mismatch');
  const entries = unzipSync(zip);
  const archive = createLiteArchive(entries);
  if (!Buffer.from(archive.zip).equals(zip) || archive.files !== manifest.files) throw new Error('Lite archive does not match its validated contents');
  return { manifest, zipPath, entries, advisories: archive.advisories };
}
