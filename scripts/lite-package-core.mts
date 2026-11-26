import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, extname } from 'node:path';
import { LITE_PACKAGE_RULES, REMOTE_FILE, REMOTE_FOLDER, byteLimit, refuseOtherPlatforms, validateLiteResources } from './lite-validation.mts';
import { unzipSync, zipSync } from 'fflate';
import { DEFAULT_LITE_HOST, LITE_HOSTS, type LiteHostId } from '../src/platform/build/lite-hosts.ts';

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

/** Where a host's build lands; each host has its own, so building one never empties another's. */
export const liteBuildFolder = (host: LiteHostId): string => `dist-lite/${host}`;
/** A host's place in an output folder shared by hosts: the default host's is the folder itself, where its
 *  outputs stood before there were hosts, another's a folder of its own inside. */
export const liteHostFolder = (base: string, host: LiteHostId): string => (host === DEFAULT_LITE_HOST ? base : `${base}/${host}`);
/** Where a host's archives, manifests and verification evidence are kept. */
export const liteArtifactFolder = (host: LiteHostId): string => liteHostFolder('artifacts/lite', host);

/** Validate the bytes that will be archived for `host`, independently of the build directory. */
export function validateLiteEntries(entries: LiteEntries, host: LiteHostId = DEFAULT_LITE_HOST): string[] {
  const rules = LITE_PACKAGE_RULES[host];
  const files = Object.keys(entries).length;
  if (rules.maxFiles !== null && files > rules.maxFiles) throw new Error(`Lite ZIP contains ${files} files, exceeding the ${rules.maxFiles}-file upload limit`);
  for (const name of Object.keys(entries)) {
    if (name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '..' || part === '.')) {
      throw new Error(`Invalid Lite resource path: ${name}`);
    }
    if (name.split('/').some(part => part.startsWith('.') || part === 'node_modules') || /(?:^|\/)(?:vite|webpack)\.config\./.test(name)) throw new Error(`Unsupported Lite file: ${name}`);
    if (!ALLOWED_EXTENSIONS.has(extname(name))) throw new Error(`Unsupported Lite file: ${name}`);
    if (/worker|onnx|tesseract|tensorflow|neural/i.test(name)) throw new Error(`Unsupported Lite runtime: ${name}`);
    if (rules.picturesOnlyRemoteFolder && name.startsWith(REMOTE_FOLDER) && !REMOTE_FILE.test(name)) throw new Error(`${REMOTE_FOLDER} holds only pictures, since the container may serve it from afar: ${name}`);
    refuseOtherPlatforms(`The file name ${name}`, name, host);
  }
  if (Object.keys(entries).filter(name => name.endsWith('.html')).join() !== 'index.html') throw new Error('Lite requires exactly one index.html');
  const entry = entries['index.html']!.length;
  if (rules.maxEntryBytes !== null && entry > rules.maxEntryBytes) throw new Error(`Lite index.html is ${entry} bytes uncompressed, over the ${byteLimit(rules.maxEntryBytes)} entry limit`);
  return validateLiteResources(entries, host);
}

export interface LiteArchive {
  zip: Uint8Array;
  files: number;
  advisories: string[];
  host: LiteHostId;
}

/** Throws where `zip` is past what `host` accepts. */
function checkZipSize(zip: Uint8Array, host: LiteHostId): void {
  const { maxZipBytes } = LITE_PACKAGE_RULES[host];
  if (zip.length > maxZipBytes) throw new Error(`Lite ZIP exceeds the ${byteLimit(maxZipBytes)} upload limit`);
}

export function createLiteArchive(entries: LiteEntries, host: LiteHostId = DEFAULT_LITE_HOST): LiteArchive {
  const advisories = validateLiteEntries(entries, host);
  const advise = LITE_PACKAGE_RULES[host].advisories;
  let textBytes = 0;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!advise || !/\.(?:html|css|js|json)$/.test(name)) continue;
    textBytes += bytes.length;
    if (bytes.length > advise.fileTextBytes) advisories.push(`${name} exceeds ${byteLimit(advise.fileTextBytes)} uncompressed`);
  }
  if (advise && textBytes > advise.totalTextBytes) advisories.push(`total text exceeds ${byteLimit(advise.totalTextBytes)} uncompressed`);
  // ZIP entry order and timestamps must not depend on the filesystem or build time.
  const ordered = Object.fromEntries(Object.keys(entries).sort().map(name => [name, entries[name]!]));
  const zip = zipSync(ordered, { level: 6, mtime: new Date(1980, 0, 1) });
  checkZipSize(zip, host);
  if (advise && zip.length > advise.zipBytes) advisories.push(`ZIP exceeds the recommended ${byteLimit(advise.zipBytes)}`);
  return { zip, files: Object.keys(entries).length, advisories, host };
}

interface LiteIdentity {
  version: string;
  buildNumber: string;
  source: string;
}

/** The archive's name: its version, its host and the start of its checksum. */
const archiveName = (version: string, host: LiteHostId, sha256: string): string => `petitmaker-${version}-${host}-${sha256.slice(0, 12)}.zip`;
const ARCHIVE_NAME = new RegExp(`^petitmaker-\\d+\\.\\d+\\.\\d+-lite-(?:(${Object.keys(LITE_HOSTS).join('|')})-)?[a-f0-9]{12}\\.zip$`);

/** Existing archives are immutable; only the latest manifest advances on a new build. */
export function writeLiteArchive(output: string, archive: LiteArchive, identity: LiteIdentity): string {
  const sha256 = createHash('sha256').update(archive.zip).digest('hex');
  const filename = archiveName(identity.version, archive.host, sha256);
  const path = join(output, filename);
  mkdirSync(output, { recursive: true });
  if (existsSync(path)) {
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== sha256) {
      throw new Error(`Lite artifact collision: ${path}`);
    }
  } else writeFileSync(path, archive.zip, { flag: 'wx' });
  const manifest = JSON.stringify({ filename, host: archive.host, ...identity, sha256, bytes: archive.zip.length, files: archive.files }, null, 2) + '\n';
  writeFileSync(join(output, filename.replace(/\.zip$/, '.json')), manifest);
  writeFileSync(join(output, 'latest.json'), manifest);
  return path;
}

/** Verify the stored archive itself before any consumer extracts or serves it. An archive named
 *  before there were hosts names none and is the default host's. */
export function readLiteArtifact(output: string, expectedVersion?: string, expectedHost: LiteHostId = DEFAULT_LITE_HOST) {
  const manifest = JSON.parse(readFileSync(join(output, 'latest.json'), 'utf8'));
  const named = ARCHIVE_NAME.exec(manifest.filename);
  if (!named) throw new Error('Invalid Lite artifact filename');
  const host = (named[1] ?? DEFAULT_LITE_HOST) as LiteHostId;
  if (host !== (manifest.host ?? DEFAULT_LITE_HOST) || host !== expectedHost) throw new Error(`Lite artifact is for another host: ${host}, expected ${expectedHost}`);
  if (expectedVersion && manifest.version !== expectedVersion) throw new Error('Lite artifact does not match the publication version');
  const zipPath = join(output, manifest.filename);
  const zip = readFileSync(zipPath);
  checkZipSize(zip, host);
  const sha256 = createHash('sha256').update(zip).digest('hex');
  const filename = named[1] ? archiveName(manifest.version, host, sha256) : `petitmaker-${manifest.version}-${sha256.slice(0, 12)}.zip`;
  if (sha256 !== manifest.sha256 || zip.length !== manifest.bytes || manifest.filename !== filename) throw new Error('Lite artifact checksum or identity mismatch');
  const entries = unzipSync(zip);
  const archive = createLiteArchive(entries, host);
  if (!Buffer.from(archive.zip).equals(zip) || archive.files !== manifest.files) throw new Error('Lite archive does not match its validated contents');
  return { manifest: { ...manifest, host }, zipPath, entries, advisories: archive.advisories };
}
