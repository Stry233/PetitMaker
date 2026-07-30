// Public-repo export CLI (Task 20, spec §16): snapshots the allowlisted subset of this
// repo (per docs/internal/deployment/public-repo-manifest.md) into a clean output directory with
// fresh history-free files, then leak-checks the result.
//
// This file is CLI-ONLY (side-effecting: reads real files off disk, writes to --out, may
// spawn npm, may set process.exitCode) and unconditionally runs `main()` at the bottom — it
// is never imported for its exports. The pure/testable core (glob matcher, manifest
// parsing, classification, leak-check re-derivation) lives in
// ./export-public-repo-core.mts, which src/__tests__/legal/repo-hygiene.test.ts imports
// directly instead of this file. See scripts/license-audit.mts's doc comment for why a
// main-module guard doesn't work under `vite-node` (the same trap this file avoids).
//
// IP-CRITICAL: internal documents and game-derived reference material must NEVER be
// exportable. This script only ever COPIES the manifest's allowlist — it never has a code
// path that copies "everything except X"; the allowlist is additive by construction, and
// the leak check re-derives its assertion from the internal glob list independently of the
// copy step's own bookkeeping.
//
// Usage:
//   vite-node scripts/export-public-repo.mts --out <dir>              copy the allowlist
//   vite-node scripts/export-public-repo.mts --out <dir> --verify      + npm ci && npm run
//                                                                       build && npm run
//                                                                       test:run in <dir>
//                                                                       (SLOW — installs a
//                                                                       full node_modules;
//                                                                       manual/CI use only)

// @ts-ignore - node:fs is untyped here (no @types/node)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { dirname, join, resolve } from 'node:path';
// @ts-ignore - node:child_process is untyped here (no @types/node)
import { execFileSync, spawnSync } from 'node:child_process';

import {
  auditStatus,
  DENYLIST_SPOTCHECK,
  findAiAttribution,
  isProbablyText,
  findLeakedPaths,
  parseManifest,
  publicGitignore,
  selectPublicPaths,
  shouldRefuseVerify,
  type ManifestGlobs,
} from './export-public-repo-core.mts';

declare const process: { argv: string[]; cwd(): string; exitCode?: number };

function parseArgs(argv: string[]): { out: string; verify: boolean; allowOpenAudit: boolean } {
  const outIdx = argv.indexOf('--out');
  const out = outIdx !== -1 ? argv[outIdx + 1] : undefined;
  if (!out) {
    throw new Error(
      'usage: vite-node scripts/export-public-repo.mts --out <dir> [--verify] [--allow-open-audit]'
    );
  }
  return { out, verify: argv.includes('--verify'), allowOpenAudit: argv.includes('--allow-open-audit') };
}

/** `git ls-files -z` — NUL-separated so filenames with non-ASCII bytes aren't quote-escaped. */
function gitTrackedFiles(rootDir: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: rootDir, maxBuffer: 1024 * 1024 * 64 }) as {
    toString(enc: string): string;
  };
  return out
    .toString('utf8')
    .split('\0')
    .filter((p) => p.length > 0);
}

function copyAllowlisted(rootDir: string, outDir: string, paths: readonly string[]): void {
  for (const rel of paths) {
    const src = join(rootDir, rel);
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

/** Explicit denylist re-scan: none of these known-internal names may exist in the output. */
function spotCheckDenylist(outDir: string): string[] {
  return DENYLIST_SPOTCHECK.filter((name) => existsSync(join(outDir, name)));
}

// The exported snapshot has no `.git` (Task 20 deliberately ships "fresh history-free
// files", not a history). But the shipped test suite includes
// `src/__tests__/legal/repo-hygiene.test.ts`, which calls `git ls-files -z` to re-derive
// its own hygiene/leak-check assertions — exactly what the REAL published public repo will
// be (a fresh `git init` + commit of this same file set) once a human pushes it. Without a
// `.git` here, that test suite fails not because the export is wrong but because our own
// verify harness doesn't yet look like a repo. `--verify` is a "this tree is
// publish-ready" claim, so it inits + commits a throwaway local repo first — same shape as
// the real publish step, scoped to `--verify` only (the plain dry-run copy stays a pure
// file snapshot, unchanged).
function initGitSnapshot(outDir: string): void {
  const run = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: outDir, stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`[export-public-repo] git snapshot init failed: git ${args.join(' ')} (exit ${result.status})`);
    }
  };
  run(['init', '-q']);
  run(['add', '-A']);
  run(['-c', 'user.email=export@localhost', '-c', 'user.name=export-public-repo', 'commit', '-q', '-m', 'export snapshot']);
}

function runVerify(outDir: string): void {
  console.log(`[export-public-repo] --verify: npm ci && npm run build && npm run test:run in ${outDir}`);
  console.log('[export-public-repo] this is SLOW (installs a full node_modules) — manual/CI use only.');
  initGitSnapshot(outDir);
  try {
    for (const args of [['ci'], ['run', 'build'], ['run', 'test:run']]) {
      const result = spawnSync('npm', args, { cwd: outDir, stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error(`[export-public-repo] verify step failed: npm ${args.join(' ')} (exit ${result.status})`);
      }
    }
  } finally {
    // Leave the directory as the snapshot again. Verifying is a side trip: it needs a git
    // repo (for the shipped suite's git-dependent tests), a node_modules and a dist, none
    // of which are part of what gets published. Leaving them behind contradicts the
    // export's "history-free files" contract, trips the publish workflow's "no .git in the
    // snapshot" assertion, and makes the publish sync copy ~15k dependency files into the
    // public checkout for git to then ignore.
    for (const artifact of ['.git', 'node_modules', 'dist', 'tsconfig.tsbuildinfo']) {
      rmSync(join(outDir, artifact), { recursive: true, force: true });
    }
  }
  console.log('[export-public-repo] --verify passed: the exported public repo builds and tests green.');
}

async function main(): Promise<void> {
  const { out, verify, allowOpenAudit } = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  // resolve() (unlike join()) treats an absolute `out` as-is instead of concatenating it
  // onto rootDir — callers pass both relative and absolute --out paths.
  const outDir = resolve(rootDir, out);

  const manifestPath = join(rootDir, 'docs', 'internal', 'deployment', 'public-repo-manifest.md');
  const manifest: ManifestGlobs = parseManifest(readFileSync(manifestPath, 'utf8'));

  const tracked = gitTrackedFiles(rootDir);
  const toCopy = selectPublicPaths(tracked, manifest);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyAllowlisted(rootDir, outDir, toCopy);

  // --- Leak check (explicit, not just "we only copied the allowlist") ---------------
  const leaked = findLeakedPaths(toCopy, manifest);
  if (leaked.length > 0) {
    throw new Error(
      `[export-public-repo] LEAK: ${leaked.length} copied path(s) match an internal glob ` +
        `(manifest conflict — a public glob and an internal glob both matched):\n` +
        leaked.map((p) => `  ${p}`).join('\n')
    );
  }
  const spotted = spotCheckDenylist(outDir);
  if (spotted.length > 0) {
    throw new Error(
      `[export-public-repo] LEAK: known-internal path(s) exist in the output by name:\n` +
        spotted.map((p) => `  ${p}`).join('\n')
    );
  }

  // --- AI-attribution scan (the export must carry no commit-trailer attribution) ----
  const attributed = findAiAttribution(
    toCopy
      .map((p) => ({ path: p, bytes: readFileSync(join(outDir, p)) as Uint8Array }))
      .filter(({ bytes }) => isProbablyText(bytes))
      .map(({ path, bytes }) => ({ path, text: Buffer.from(bytes).toString('utf8') })),
  );
  if (attributed.length > 0) {
    throw new Error(
      `[export-public-repo] AI ATTRIBUTION: ${attributed.length} copied file(s) contain a commit-trailer ` +
        `attribution, which the public repository does not carry (authorship is declared in the project's ` +
        `own documents):\n` +
        attributed.map(({ path, marker }) => `  ${path}: ${marker}`).join('\n')
    );
  }

  writeFileSync(join(outDir, '.gitignore'), publicGitignore(), 'utf8');

  console.log(`[export-public-repo] copied ${toCopy.length}/${tracked.length} tracked files into ${outDir}`);
  console.log('[export-public-repo] leak check passed (no internal-glob match, no denylisted path present).');

  // --- Asset-provenance audit gate (docs/internal/legal/asset-provenance.md) ------------------
  // Always warn while the audit is open — the dry-run copy above is NOT gated by this
  // (inspection is legitimate); only --verify (a publish-readiness claim) is refused below.
  const status = auditStatus(rootDir);
  if (status.open) {
    console.warn(
      `[export-public-repo] WARNING: asset-provenance audit is OPEN (${status.noneYetCount} row(s) still ` +
        `"permission basis: none-yet") — see docs/internal/legal/asset-provenance.md. This export may include ` +
        `assets not yet cleared for public release.`
    );
  }

  if (verify) {
    if (shouldRefuseVerify(status, allowOpenAudit)) {
      throw new Error(
        `[export-public-repo] REFUSED: --verify while the asset-provenance audit is OPEN ` +
          `(${status.noneYetCount} row(s) still "none-yet"). Pass --allow-open-audit to run anyway, or ` +
          `close the audit first (docs/internal/legal/asset-provenance.md).`
      );
    }
    runVerify(outDir);
  }
}

main().catch((err) => {
  console.error('[export-public-repo] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
