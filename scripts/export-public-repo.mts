// Public-repo export CLI: snapshots the allowlisted subset of this repo (per
// docs/internal/deployment/public-repo-manifest.md) into a clean output directory with
// fresh history-free files, then leak-checks the result.
//
// This file is CLI-ONLY (side-effecting: reads real files off disk, writes to --out, may
// spawn npm, may set process.exitCode) and unconditionally runs `main()` at the bottom — it
// is never imported for its exports. The pure/testable core (glob matcher, manifest
// parsing, classification, leak-check re-derivation) lives in
// ./export-public-repo-core.mts, which src/__tests__/legal/repo-hygiene.test.ts imports
// directly instead of this file. scripts/license-audit.mts's doc comment says why a
// main-module guard cannot host both under `vite-node`.
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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { dirname, join, resolve } from 'node:path';
// @ts-ignore - node:child_process is untyped here (no @types/node)
import { execFileSync, spawnSync } from 'node:child_process';

import {
  AGENT_DOC_NAMES,
  auditStatus,
  DENYLIST_SPOTCHECK,
  findAgentDocPointers,
  findAiAttribution,
  findByBasename,
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

/** Every file in the output, as a path relative to it. */
function walkOutput(outDir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(outDir, rel), { withFileTypes: true }) as Array<{
    name: string;
    isDirectory(): boolean;
  }>) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkOutput(outDir, child));
    else out.push(child);
  }
  return out;
}

// The exported snapshot ships fresh history-free files, so it has no `.git`. But the
// shipped test suite includes `src/__tests__/legal/repo-hygiene.test.ts`, which calls
// `git ls-files -z` to re-derive its own hygiene/leak-check assertions — exactly what the
// published public repo is (a fresh `git init` + commit of this same file set). Without a
// `.git` here, that suite fails because the verify harness doesn't look like a repo, not
// because the export is wrong. `--verify` is a "this tree is publish-ready" claim, so it
// inits + commits a throwaway local repo first, the same shape as the real publish step;
// the plain dry-run copy stays a pure file snapshot.
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
  // The agent-instruction files sit beside the source they describe, so they have no fixed
  // path for the check above to name — the whole output is walked for the basename instead.
  const denied = findByBasename(walkOutput(outDir), AGENT_DOC_NAMES);
  if (denied.length > 0) {
    throw new Error(
      `[export-public-repo] LEAK: agent-instruction file(s) exist in the output:\n` +
        denied.map((p) => `  ${p}`).join('\n')
    );
  }

  const copiedText = toCopy
    .map((p) => ({ path: p, bytes: readFileSync(join(outDir, p)) as Uint8Array }))
    .filter(({ bytes }) => isProbablyText(bytes))
    .map(({ path, bytes }) => ({ path, text: Buffer.from(bytes).toString('utf8') }));

  // --- Agent-doc pointer scan (the snapshot has no agent instructions to point at) ----
  const pointers = findAgentDocPointers(copiedText);
  if (pointers.length > 0) {
    throw new Error(
      `[export-public-repo] INTERNAL POINTER: ${pointers.length} copied file(s) name an ` +
        `agent-instruction file the public repository does not have. State the fact in the shipped ` +
        `file and keep the pointer in the agent doc:\n` +
        pointers.map(({ path, name }) => `  ${path}: ${name}`).join('\n')
    );
  }

  // --- AI-attribution scan (the export must carry no commit-trailer attribution) ----
  const attributed = findAiAttribution(copiedText);
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
