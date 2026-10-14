// CLI that renders the canonical headers policy into the committed host configurations, deployment
// reference (private tree only) and index CSP meta tag. The policy lives in
// security/headers-policy.ts and the pure renderers in generate-headers-core.mts, so tests can
// import them without running this file's filesystem writes.
//
// Usage (see package.json):
//   vite-node scripts/generate-headers.mts            regenerate all outputs
//   vite-node scripts/generate-headers.mts --check     drift mode: regenerate to
//                                                       memory/temp, diff against
//                                                       committed, exit 1 on drift

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { HEADERS_POLICY } from '../security/headers-policy';
import { headerOutputs } from './generate-headers-core.mts';

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

  const outputs = headerOutputs(HEADERS_POLICY, {
    internalDocs: existsSync(join(rootDir, 'docs', 'internal')),
    indexHtml: readFileSync(join(rootDir, 'index.html'), 'utf8'),
  });
  for (const { path, content } of outputs) writeIfChanged(join(rootDir, path), content, drift, check);
  const names = outputs.map((o) => o.path).join(', ');

  if (check) {
    if (drift.paths.length > 0) {
      console.error('[generate-headers] DRIFT: the following files are out of date — run `npm run legal:headers`:');
      for (const p of drift.paths) console.error(`  ${p}`);
      process.exitCode = 1;
    } else {
      console.log(`[generate-headers] up to date (${names}).`);
    }
  } else {
    console.log(`[generate-headers] wrote ${names}.`);
  }
}

main().catch((err) => {
  console.error('[generate-headers] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
