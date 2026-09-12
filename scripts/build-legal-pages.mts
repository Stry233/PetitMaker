// Generates static documents, robots, sitemap, and security.txt after Vite.
// PETIT_RELEASE=1 enables release validation; path-based previews keep only their noindex app.

// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join } from 'node:path';

import { LEGAL } from '../src/legal/config';
import { DEPLOY_TARGETS } from '../src/legal/deploy-targets';
import { pagePlan, writeAll, resolveMode } from './legal-pages-core.mts';
import { redirectsFile } from './redirects-core.mts';

declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  exitCode?: number;
};

async function main(): Promise<void> {
  if (process.env.PETIT_BASE_PATH && process.env.PETIT_BASE_PATH !== '/') return;
  const mode = resolveMode(process.env);
  const distDir = join(process.cwd(), 'dist');

  if (!existsSync(distDir)) {
    console.warn(`[build-legal-pages] ${distDir} does not exist yet — run "vite build" first.`);
  }
  mkdirSync(distDir, { recursive: true });

  // Production homepages must remain indexable even when verified from a local source checkout.
  const indexPath = join(distDir, 'index.html');
  if (mode === 'release' && existsSync(indexPath) && /name="robots"[^>]*noindex/.test(readFileSync(indexPath, 'utf8'))) {
    throw new Error(
      'dist/index.html carries noindex in a release build. Build production at the domain root.'
    );
  }

  writeAll(distDir, LEGAL, mode);

  // Cloudflare reads `_redirects`; the Chinese edge serves slashed page paths and receives none.
  if (LEGAL.canonicalOrigin === DEPLOY_TARGETS.global.canonicalOrigin) {
    writeFileSync(join(distDir, '_redirects'), redirectsFile(pagePlan(LEGAL)), 'utf8');
  }

  console.log(`[build-legal-pages] wrote static legal pages + sitemap/robots/security.txt into ${distDir} (mode: ${mode}).`);
}

main().catch((err) => {
  console.error('[build-legal-pages] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
