// Vite plugins that let the web app fetch its first-use files ahead of use.
//
// The worker file manifest: a module worker's chunks exist only in its own bundle, so the page
// cannot name them to prefetch them. `workerFileCollector` runs inside every worker build and
// records each worker entry's output files; `workerFileInjector` runs in the app build, whose chunks
// render after every worker has been bundled, and writes the record over `WORKER_FILES_TOKEN` (the
// value `define` gives `__PETIT_WORKER_FILES__`) as base64 JSON, which survives any string quoting.
//
// The map check's folder: `public/moderation/` keeps stable source names, and the build moves the
// copy Vite writes to `dist/moderation/` into `dist/moderation/<content hash>/`. The folder name
// changes exactly when a file in it does, so the host may cache every file under `/moderation/`
// as immutable; `__PETIT_MODERATION_DIR__` carries the folder to the app.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export const WORKER_FILES_TOKEN = '__PETIT_WORKER_FILES_TOKEN__';

/** One worker bundle's output, base-relative: its code chunks and its emitted assets. */
export interface WorkerFiles { chunks: string[]; assets: string[] }

const workerFiles = new Map<string, WorkerFiles>();
const SRC = resolve('src');

export function workerFileCollector(): Plugin {
  return {
    name: 'petit:worker-file-collector',
    apply: 'build',
    generateBundle(_options, bundle) {
      const outputs = Object.values(bundle);
      const entry = outputs.find((o) => o.type === 'chunk' && o.isEntry && o.facadeModuleId);
      if (!entry || entry.type !== 'chunk') return;
      const key = relative(SRC, entry.facadeModuleId!.split('?')[0]!).replace(/\\/g, '/');
      workerFiles.set(key, {
        chunks: outputs.filter((o) => o.type === 'chunk').map((o) => o.fileName).sort(),
        assets: outputs.filter((o) => o.type === 'asset').map((o) => o.fileName).sort(),
      });
    },
  };
}

export function workerFileInjector(): Plugin {
  return {
    name: 'petit:worker-file-injector',
    apply: 'build',
    renderChunk(code) {
      if (!code.includes(WORKER_FILES_TOKEN)) return null;
      const record = Object.fromEntries([...workerFiles].sort(([a], [b]) => a.localeCompare(b)));
      return { code: code.replaceAll(WORKER_FILES_TOKEN, Buffer.from(JSON.stringify(record)).toString('base64')), map: null };
    },
  };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** `moderation/<first 12 hex of a SHA-256 over every file's path and bytes>/`. */
export function moderationDir(publicDir = resolve('public')): string {
  const root = join(publicDir, 'moderation');
  if (!existsSync(root)) return 'moderation/';
  const hash = createHash('sha256');
  for (const file of filesUnder(root).sort()) {
    hash.update(relative(root, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(readFileSync(file));
  }
  return `moderation/${hash.digest('hex').slice(0, 12)}/`;
}

export function moderationFingerprint(dir: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'petit:moderation-fingerprint',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const from = join(outDir, 'moderation');
      if (!existsSync(from) || dir === 'moderation/') return;
      const folder = dir.split('/')[1]!;
      const to = join(from, folder);
      mkdirSync(to, { recursive: true });
      for (const name of readdirSync(from)) if (name !== folder) renameSync(join(from, name), join(to, name));
    },
  };
}
