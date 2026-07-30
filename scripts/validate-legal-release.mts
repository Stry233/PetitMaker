// Thin release-mode gate for the LEGAL config (Task 17 / spec §5): fails
// `npm run build:release` BEFORE the (slow) tsc+vite build even starts if any
// launch-blocker field is still empty/placeholder/denylisted. All the actual
// validation logic lives in src/legal/validate-config.ts (already unit-tested
// in src/__tests__/legal/validate-config.test.ts) — this file only wires it to
// a CLI exit code.
//
// This file is CLI-ONLY and unconditionally runs `main()` at the bottom (see
// scripts/build-legal-pages.mts's doc comment for why an import.meta.url-based
// guard doesn't work under `vite-node`). It exports nothing and is not
// imported by any test.
//
// Usage: vite-node scripts/validate-legal-release.mts

import { LEGAL } from '../src/legal/config';
import { validateLegalConfig } from '../src/legal/validate-config';

declare const process: { exitCode?: number };

function main(): void {
  const problems = validateLegalConfig(LEGAL, 'release');
  if (problems.length > 0) {
    console.error(`[legal:validate] LEGAL config is not release-ready (${problems.length} problem(s)):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log('[legal:validate] LEGAL config is release-ready.');
}

main();
