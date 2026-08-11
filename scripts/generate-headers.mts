// Headers-policy generator CLI: renders security/headers-policy.ts into every
// derived surface — public/_headers, vercel.json, docs/internal/deployment/esa-headers.md
// — and rewrites index.html's CSP <meta> line (+ its explanation comment) in
// place.
//
// This file is CLI-ONLY (side-effecting: reads/writes real files, may set
// process.exitCode) and unconditionally runs `main()` at the bottom — it is
// never imported for its exports. The pure/testable core (rewriteIndexHtmlCsp,
// stringifyVercelJson) lives in ./generate-headers-core.mts, and the policy +
// per-platform string/object generators (toNetlifyHeaders, toVercelJson,
// toEsaDoc, toCspMeta) live in ../security/headers-policy.ts — both are
// imported directly by src/__tests__/legal/headers-policy.test.ts instead of
// this file. See scripts/license-audit.mts's doc comment for why a
// main-module guard doesn't work under `vite-node` (the same trap this file
// avoids by never being imported for anything but its CLI side effect).
//
// Usage (see package.json):
//   vite-node scripts/generate-headers.mts            regenerate all outputs
//   vite-node scripts/generate-headers.mts --check     drift mode: regenerate to
//                                                       memory/temp, diff against
//                                                       committed, exit 1 on drift

// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { dirname, join } from 'node:path';

import { HEADERS_POLICY, toEsaDoc, toNetlifyHeaders, toVercelJson, type VercelJsonLike } from './../security/headers-policy';
// The site's domains live in the legal config (the single source for canonicalOrigin);
// the ESA runbook lists the legacy-domain 301s from there rather than repeating them.
import { LEGAL } from '../src/legal/config';
import { rewriteIndexHtmlCsp, stringifyVercelJson } from './generate-headers-core.mts';

declare const process: { argv: string[]; cwd(): string; exitCode?: number };

function writeIfChanged(path: string, content: string, drift: { paths: string[] }, check: boolean): void {
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (prev === content) return;
  if (check) {
    drift.paths.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const rootDir = process.cwd();
  const drift: { paths: string[] } = { paths: [] };

  // public/_headers
  const headersPath = join(rootDir, 'public', '_headers');
  writeIfChanged(headersPath, toNetlifyHeaders(HEADERS_POLICY), drift, check);

  // vercel.json — merge into the existing parsed object so unrelated keys
  // ($schema, the "//" comment, the /assets/(.*) cache rule) survive untouched.
  const vercelPath = join(rootDir, 'vercel.json');
  const existingVercel: VercelJsonLike = existsSync(vercelPath) ? JSON.parse(readFileSync(vercelPath, 'utf8')) : {};
  const nextVercel = stringifyVercelJson(toVercelJson(existingVercel, HEADERS_POLICY));
  writeIfChanged(vercelPath, nextVercel, drift, check);

  // docs/internal/deployment/esa-headers.md
  const esaPath = join(rootDir, 'docs', 'internal', 'deployment', 'esa-headers.md');
  writeIfChanged(esaPath, toEsaDoc(HEADERS_POLICY, {
    canonicalOrigin: LEGAL.canonicalOrigin, legacyOrigins: LEGAL.legacyOrigins,
  }), drift, check);

  // index.html — surgical CSP <meta> (+ comment) rewrite only.
  const indexPath = join(rootDir, 'index.html');
  const existingIndex = readFileSync(indexPath, 'utf8');
  const nextIndex = rewriteIndexHtmlCsp(existingIndex, HEADERS_POLICY);
  writeIfChanged(indexPath, nextIndex, drift, check);

  if (check) {
    if (drift.paths.length > 0) {
      console.error('[generate-headers] DRIFT: the following files are out of date — run `npm run legal:headers`:');
      for (const p of drift.paths) console.error(`  ${p}`);
      process.exitCode = 1;
    } else {
      console.log('[generate-headers] up to date (public/_headers, vercel.json, docs/internal/deployment/esa-headers.md, index.html).');
    }
  } else {
    console.log('[generate-headers] wrote public/_headers, vercel.json, docs/internal/deployment/esa-headers.md; rewrote index.html CSP meta.');
  }
}

main().catch((err) => {
  console.error('[generate-headers] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
