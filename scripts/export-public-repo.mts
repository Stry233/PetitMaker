// CLI that copies the export manifest's allowlist into a clean snapshot and independently checks
// the result for withheld files. Pure parsing and classification live in export-public-repo-core.mts
// so tests can import them without invoking filesystem writes or subprocesses.
//
// Usage:
//   vite-node scripts/export-public-repo.mts --out <dir>              copy the allowlist
//   vite-node scripts/export-public-repo.mts --out <dir> --verify      + install, build, typecheck
//                                                                       and run the tests whose inputs
//                                                                       differ from this checkout's
//                                                                       commit inside <dir>
//   vite-node scripts/export-public-repo.mts --list-verify-tests      print that test scope as JSON
//
// --verify does not rerun the whole suite: a release requires it to have passed on this commit
// first. It needs this checkout's own node_modules to compute the scope.

// @ts-ignore - node:fs is untyped here (no @types/node)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { dirname, join, relative, resolve, sep } from 'node:path';
// @ts-ignore - node:child_process is untyped here (no @types/node)
import { execFileSync, spawnSync } from 'node:child_process';

import {
  AGENT_DOC_NAMES,
  auditStatus,
  DENYLIST_SPOTCHECK,
  findAgentDocPointers,
  findAiAttribution,
  findByBasename,
  findLeakedPaths,
  isProbablyText,
  listFiles,
  parseManifest,
  publicGitignore,
  selectPublicPaths,
  selectSnapshotTests,
  shouldRefuseVerify,
  snapshotTestSeeds,
  type ManifestGlobs,
} from './export-public-repo-core.mts';

declare const process: { argv: string[]; cwd(): string; exitCode?: number };

interface Args { out?: string; verify: boolean; listTests: boolean; assumeChanged: string[] }

function parseArgs(argv: string[]): Args {
  if (argv.includes('--allow-open-audit')) {
    throw new Error('--allow-open-audit is no longer supported; omit --verify for an inspection-only export.');
  }
  const outIdx = argv.indexOf('--out');
  const out = outIdx !== -1 ? argv[outIdx + 1] : undefined;
  const listTests = argv.includes('--list-verify-tests');
  // Treats a path as changed since the commit, as a publication refresh would leave it.
  const assumeChanged = argv.flatMap((arg, i) => (arg === '--assume-changed' && argv[i + 1] ? [argv[i + 1]!] : []));
  if (!out && !listTests) {
    throw new Error(
      'usage: vite-node scripts/export-public-repo.mts --out <dir> [--verify] | --list-verify-tests [--assume-changed <path>]...'
    );
  }
  return { out, verify: argv.includes('--verify'), listTests, assumeChanged };
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

// Verification uses a throwaway git commit because the exported hygiene tests inspect tracked
// files. The temporary repository has the same one-snapshot shape as the published checkout.
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

/** Tracked paths whose working-tree content differs from the checked-out commit. */
function gitChangedFiles(rootDir: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: rootDir, maxBuffer: 1024 * 1024 * 16 }) as {
    toString(enc: string): string;
  };
  return out.toString('utf8').split('\0').filter((p) => p.length > 0);
}

/** Test files Vitest's import graph relates to any of `seeds`, from this checkout's config. */
async function relatedTests(rootDir: string, seeds: readonly string[]): Promise<string[]> {
  const { createVitest } = await import('vitest/node');
  const vitest = await createVitest('test', {
    watch: false, run: true, passWithNoTests: true, related: seeds.map((p) => join(rootDir, p)),
  });
  try {
    const specs = await vitest.getRelevantTestSpecifications();
    return specs.map((spec) => relative(rootDir, spec.moduleId).split(sep).join('/'));
  } finally {
    await vitest.close();
  }
}

/** The public tests whose inputs can differ between the snapshot and this checkout's commit. */
async function snapshotTestScope(rootDir: string, tracked: readonly string[], published: readonly string[], assumeChanged: readonly string[]): Promise<string[]> {
  const changed = [...new Set([...gitChangedFiles(rootDir), ...assumeChanged])];
  const sources = published
    .filter((p) => /\.[cm]?[jt]sx?$/.test(p))
    .map((path) => ({ path, text: readFileSync(join(rootDir, path), 'utf8') as string }));
  const seeds = snapshotTestSeeds({ tracked, published, changed, sources });
  return selectSnapshotTests(published, seeds, await relatedTests(rootDir, seeds));
}

// The snapshot runs its own install, the full production build (whose `tsc -b` typechecks every
// shipped source and test, so an import of a withheld file fails here), the scripts typecheck, and
// the scoped tests.
function runVerify(outDir: string, tests: readonly string[]): void {
  console.log(`[export-public-repo] --verify: install, build, typecheck and ${tests.length} scoped test file(s) in ${outDir}`);
  for (const test of tests) console.log(`  ${test}`);
  initGitSnapshot(outDir);
  try {
    for (const args of [
      ['ci', '--ignore-scripts'],
      ['run', 'build'],
      ['exec', '--', 'tsc', '--noEmit', '-p', 'tsconfig.scripts.json'],
      ['exec', '--', 'vitest', 'run', ...tests],
    ]) {
      const result = spawnSync('npm', args, { cwd: outDir, stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error(`[export-public-repo] verify step failed: npm ${args.slice(0, 5).join(' ')} (exit ${result.status})`);
      }
    }
  } finally {
    // Restore the output to publishable source files after verification.
    for (const artifact of ['.git', 'node_modules', 'dist', 'tsconfig.tsbuildinfo', '.bundle-packages.json']) {
      rmSync(join(outDir, artifact), { recursive: true, force: true });
    }
  }
  console.log('[export-public-repo] --verify passed: the exported public repo builds and its scoped tests pass.');
}

async function main(): Promise<void> {
  const { out, verify, listTests, assumeChanged } = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  if (listTests) {
    const manifest = parseManifest(readFileSync(join(rootDir, 'docs', 'internal', 'deployment', 'public-repo-manifest.md'), 'utf8'));
    const tracked = gitTrackedFiles(rootDir);
    console.log(JSON.stringify(await snapshotTestScope(rootDir, tracked, selectPublicPaths(tracked, manifest), assumeChanged)));
    return;
  }
  const status = auditStatus(rootDir);
  if (verify && shouldRefuseVerify(status)) {
    throw new Error(
      '[export-public-repo] REFUSED: verification requires a ledger with one CLOSED audit status '
      + `and no unresolved permission rows (${status.noneYetCount} row(s) still "none-yet"). `
      + 'A missing or malformed ledger also blocks verification. Omit --verify for inspection only.',
    );
  }
  // Callers may provide a relative or absolute output path.
  const outDir = resolve(rootDir, out!);

  const manifestPath = join(rootDir, 'docs', 'internal', 'deployment', 'public-repo-manifest.md');
  const manifest: ManifestGlobs = parseManifest(readFileSync(manifestPath, 'utf8'));

  const tracked = gitTrackedFiles(rootDir);
  const toCopy = selectPublicPaths(tracked, manifest);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  copyAllowlisted(rootDir, outDir, toCopy);

  // Recheck the selected output independently of the allowlist pass.
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
  // Agent-instruction files can occur at any depth, so scan by basename.
  const denied = findByBasename(listFiles(outDir), AGENT_DOC_NAMES);
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

  // Public files cannot point to agent instructions that the snapshot omits.
  const pointers = findAgentDocPointers(copiedText);
  if (pointers.length > 0) {
    throw new Error(
      `[export-public-repo] INTERNAL POINTER: ${pointers.length} copied file(s) name an ` +
        `agent-instruction file the public repository does not have. State the fact in the shipped ` +
        `file and keep the pointer in the agent doc:\n` +
        pointers.map(({ path, name }) => `  ${path}: ${name}`).join('\n')
    );
  }

  // The snapshot declares project authorship without development-history trailers.
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

  if (status.open) {
    console.warn(
      '[export-public-repo] WARNING: asset-provenance review is not verifiably closed '
      + `(${status.noneYetCount} unresolved permission row(s)). This export is for inspection only.`,
    );
  }

  if (verify) runVerify(outDir, await snapshotTestScope(rootDir, tracked, toCopy, assumeChanged));
}

main().catch((err) => {
  console.error('[export-public-repo] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
