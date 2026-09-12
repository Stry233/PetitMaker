// License-audit CLI: lockfile prod-dependency closure + shipped-bundle refinement →
// THIRD_PARTY_NOTICES.md + licenses/<pkg>/LICENSE (+NOTICE).
//
// This file is CLI-ONLY (side-effecting: reads package-lock.json off disk, writes files, may set
// process.exitCode) and unconditionally runs `main()` at the bottom — it is never imported for
// its exports. The pure/testable core (computeClosure, auditPackages, renderNoticesMarkdown, …)
// lives in ./license-audit-core.mts, which src/__tests__/legal/license-audit.test.ts imports
// directly instead of this file.
//
// (A main-module guard — `import.meta.url === file://${process.argv[1]}` — cannot host both
// the exports and the CLI in one file: `vite-node` invokes the target script without rewriting
// `process.argv[1]` to the script's own path (argv[1] stays the vite-node binary), so the guard
// never matches and the CLI silently no-ops. Hence a pure core plus this always-executing CLI
// file, the split every generator script in this directory uses.)
//
// Usage:
//   vite-node scripts/license-audit.mts            generate THIRD_PARTY_NOTICES.md + license tree
//   vite-node scripts/license-audit.mts --check     drift mode: regenerate to a temp dir, diff
//                                                    against committed, exit 1 on drift

// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
// @ts-ignore - node:os is untyped here (no @types/node)
import { tmpdir } from 'node:os';
// @ts-ignore - node:path is untyped here (no @types/node)
import { dirname, join } from 'node:path';
import {
  auditPackages,
  computeClosure,
  expectedLicenseTreeFiles,
  filesEqual,
  FONT_ENTRIES,
  renderNoticesMarkdown,
  writeLicenseTree,
  writeTextFile,
  type LockJson,
} from './license-audit-core.mts';

// Minimal ambient shape for the pieces of `process` this script uses — this repo declares the node
// globals it uses locally, per file, rather than adding an @types/node dependency.
declare const process: { argv: string[]; cwd(): string; exitCode?: number };

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const rootDir = process.cwd();

  const lock: LockJson = JSON.parse(readFileSync(join(rootDir, 'package-lock.json'), 'utf8'));
  const closure = computeClosure(lock);

  const bundlePath = join(rootDir, '.bundle-packages.json');
  if (existsSync(bundlePath)) {
    const bundleNames: string[] = JSON.parse(readFileSync(bundlePath, 'utf8'));
    const closureNames = new Set(closure.map((c) => c.name));
    const missingFromClosure = bundleNames.filter((n) => !closureNames.has(n));
    const missingFromBundle = [...closureNames].filter((n) => !bundleNames.includes(n));
    if (missingFromClosure.length > 0 || missingFromBundle.length > 0) {
      console.warn('[license-audit] closure/bundle mismatch (using the union for output):');
      if (missingFromClosure.length > 0) {
        console.warn(`  in shipped bundle, not in lockfile closure: ${missingFromClosure.join(', ')}`);
      }
      if (missingFromBundle.length > 0) {
        console.warn(`  in lockfile closure, not observed in shipped bundle: ${missingFromBundle.join(', ')}`);
      }
    }
    for (const name of missingFromClosure) {
      const path = `node_modules/${name}`;
      const pkg = lock.packages[path];
      if (pkg) closure.push({ name, path, version: pkg.version ?? '' });
    }
  } else {
    console.warn(
      '[license-audit] no .bundle-packages.json found — run `npm run build` first to cross-check the ' +
        'shipped bundle; proceeding with the lockfile closure alone.'
    );
  }

  const audits = auditPackages(closure, { rootDir });
  const notices = renderNoticesMarkdown(audits);

  if (check) {
    const tmp = mkdtempSync(join(tmpdir(), 'license-audit-'));
    try {
      const tmpTreeRoot = join(tmp, 'licenses');
      await writeLicenseTree(audits, tmpTreeRoot);

      let drift = false;

      const committedNoticesPath = join(rootDir, 'docs', 'THIRD_PARTY_NOTICES.md');
      const committedNotices = existsSync(committedNoticesPath) ? readFileSync(committedNoticesPath, 'utf8') : '';
      if (committedNotices !== notices) {
        console.error('[license-audit] DRIFT: THIRD_PARTY_NOTICES.md is out of date — run `npm run legal:licenses`.');
        drift = true;
      }

      const realTreeRoot = join(rootDir, 'licenses');
      const expected = expectedLicenseTreeFiles(audits);
      for (const rel of expected) {
        const tmpFile = join(tmpTreeRoot, rel);
        const realFile = join(realTreeRoot, rel);
        if (!existsSync(realFile)) {
          console.error(`[license-audit] DRIFT: missing licenses/${rel}`);
          drift = true;
        } else if (!filesEqual(tmpFile, realFile)) {
          console.error(`[license-audit] DRIFT: licenses/${rel} differs from the installed package's license file`);
          drift = true;
        }
      }

      for (const font of FONT_ENTRIES) {
        const fontLicensePath = join(realTreeRoot, font.dirName, 'LICENSE');
        if (!existsSync(fontLicensePath) || statSync(fontLicensePath).size === 0) {
          console.error(`[license-audit] DRIFT: missing/empty licenses/${font.dirName}/LICENSE`);
          drift = true;
        }
      }

      if (drift) {
        process.exitCode = 1;
      } else {
        console.log(`[license-audit] up to date (${audits.length} packages, ${FONT_ENTRIES.length} font entries).`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    mkdirSync(dirname(join(rootDir, 'docs', 'THIRD_PARTY_NOTICES.md')), { recursive: true });
    writeTextFile(join(rootDir, 'docs', 'THIRD_PARTY_NOTICES.md'), notices);
    await writeLicenseTree(audits, join(rootDir, 'licenses'));
    console.log(`[license-audit] wrote THIRD_PARTY_NOTICES.md (${audits.length} packages).`);
    console.log(
      '[license-audit] Font license entries (licenses/{alibaba-puhuiti-3,quicksand}/LICENSE) are ' +
        'fetched/verified manually — this script does not regenerate them.'
    );
  }
}

main().catch((err) => {
  console.error('[license-audit] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
