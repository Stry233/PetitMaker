// Static legal-page generator CLI: renders every doc in src/legal/registry.ts
// (both languages where a doc has one) into dist/<slug>/index.html +
// dist/zh/<slug>/index.html, plus dist/sitemap.xml, dist/robots.txt,
// dist/.well-known/security.txt, and copies licenses/ through.
//
// This file is CLI-ONLY (side-effecting: reads the LEGAL config, writes files
// under dist/, may set process.exitCode) and unconditionally runs `main()` at
// the bottom — it is never imported for its exports. The pure/testable core
// (pageHtml, sitemapXml, securityTxt, writeAll, …) lives in
// ./legal-pages-core.mts, which src/__tests__/legal/build-pages.test.ts
// imports directly instead of this file. scripts/license-audit.mts's doc
// comment says why a main-module guard cannot host both under `vite-node`.
//
// Usage (see package.json):
//   vite-node scripts/build-legal-pages.mts     (run after `vite build`)
//
// Mode: PETIT_RELEASE=1 in the environment selects 'release' (any config
// problem or unresolved token throws); otherwise 'dev' (warnings only, except
// an unresolved token, which is always a bug). package.json's `build:release`
// chain sets PETIT_RELEASE=1 only for the immediately-following
// `npm run legal:validate` step — POSIX inline env-var scoping does not carry
// across `&&` — and that step hard-fails (`process.exitCode = 1`, halting the
// chain) on a release-invalid config. So in the real release pipeline the config
// is already proven release-ready and this script's own `mode` detection is a
// second check rather than the gate.

// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join } from 'node:path';

import { LEGAL } from '../src/legal/config';
import { writeAll, resolveMode } from './legal-pages-core.mts';

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  const mode = resolveMode(process.env);
  const distDir = join(process.cwd(), 'dist');

  if (!existsSync(distDir)) {
    console.warn(`[build-legal-pages] ${distDir} does not exist yet — run "vite build" first.`);
  }
  mkdirSync(distDir, { recursive: true });

  // vite.config.ts writes `noindex` into index.html for any build with no release marker, which
  // is right for the dev site and catastrophic for production: the site would leave the search
  // index silently, and nothing else in the pipeline reads that tag. A release build is the one
  // place the two can be told apart, so it is checked here rather than trusted.
  const indexPath = join(distDir, 'index.html');
  if (mode === 'release' && existsSync(indexPath) && /name="robots"[^>]*noindex/.test(readFileSync(indexPath, 'utf8'))) {
    throw new Error(
      'dist/index.html carries noindex in a RELEASE build — it was built from an unstamped tree, '
      + 'so the site would be dropped from search. Publish through the workflow, which stamps first.'
    );
  }

  writeAll(distDir, LEGAL, mode);

  console.log(`[build-legal-pages] wrote static legal pages + sitemap/robots/security.txt into ${distDir} (mode: ${mode}).`);
}

main().catch((err) => {
  console.error('[build-legal-pages] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
