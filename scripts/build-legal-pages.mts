// Static legal-page generator CLI: renders every doc in src/legal/registry.ts
// (both languages where a doc has one) into dist/<slug>/index.html +
// dist/zh/<slug>/index.html, plus dist/sitemap.xml, dist/robots.txt,
// dist/.well-known/security.txt, and copies licenses/ through.
// See docs/internal/superpowers/specs/2026-07-14-legal-docs-design.md §14/§15.
//
// This file is CLI-ONLY (side-effecting: reads the LEGAL config, writes files
// under dist/, may set process.exitCode) and unconditionally runs `main()` at
// the bottom — it is never imported for its exports. The pure/testable core
// (pageHtml, sitemapXml, securityTxt, writeAll, …) lives in
// ./legal-pages-core.mts, which src/__tests__/legal/build-pages.test.ts
// imports directly instead of this file. See that file's doc comment for why
// a main-module guard doesn't work under `vite-node` (the same trap
// scripts/license-audit.mts documents and works around).
//
// Usage (see package.json):
//   vite-node scripts/build-legal-pages.mts     (run after `vite build`)
//
// Mode: PETIT_RELEASE=1 in the environment selects 'release' (any config
// problem or unresolved token throws); otherwise 'dev' (warnings only, except
// a genuinely unresolved non-deferred token, which is always a bug). NOTE:
// package.json's `build:release` chain sets PETIT_RELEASE=1 only for the
// immediately-following `npm run legal:validate` step (POSIX inline env-var
// scoping does not carry across `&&`) — that step already hard-fails
// (`process.exitCode = 1`, halting the `&&` chain) on a release-invalid
// config, so by the time this script runs in the real release pipeline the
// config has ALREADY been proven release-ready; this script's own `mode`
// detection is a defense-in-depth re-check, not the primary gate.

// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, mkdirSync } from 'node:fs';
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

  writeAll(distDir, LEGAL, mode);

  console.log(`[build-legal-pages] wrote static legal pages + sitemap/robots/security.txt into ${distDir} (mode: ${mode}).`);
}

main().catch((err) => {
  console.error('[build-legal-pages] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
