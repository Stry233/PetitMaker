// Writes the build identity into `build-info.json` from THIS repository's history —
// the one and only place the build number is produced. Every build then reads that
// file, so the number is identical on any host, at any clone depth, with no git at
// all (see scripts/build-info-core.mts for why deriving it per build cannot work).
//
// CLI-ONLY (side-effecting, may set process.exitCode) and unconditionally runs main()
// at the bottom — the pure core lives in ./build-info-core.mts and is what the tests
// and vite.config.ts import. scripts/license-audit.mts's doc comment says why a
// main-module guard cannot host both under vite-node.
//
// Usage:
//   vite-node scripts/stamp-build.mts            write build-info.json (refuses to
//                                                lower the number — only the repo
//                                                that owns it may stamp)
//   vite-node scripts/stamp-build.mts --check     verify the committed stamp came
//                                                from this history; report how far
//                                                HEAD has moved since

// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:child_process is untyped here (no @types/node)
import { execSync } from 'node:child_process';

import { STAMP_PATH, checkStamp, parseStamp, stampFromGit } from './build-info-core.mts';

declare const process: { argv: string[]; exitCode?: number };

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/** Exit-code form, for the queries whose answer IS the exit code. */
function gitSucceeds(args: string): boolean {
  try {
    execSync(`git ${args}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const read = (): string | null => (existsSync(STAMP_PATH) ? readFileSync(STAMP_PATH, 'utf8') : null);

function check(): void {
  const verdict = checkStamp(read(), git, gitSucceeds);
  if (!verdict.ok) {
    console.error(`[stamp-build] ${verdict.reason}`);
    process.exitCode = 1;
    return;
  }
  const { buildNumber, sha } = verdict.stamp;
  // "Stamped" is not enough: an export copies the WORKING TREE, so an uncommitted stamp
  // would publish a number that is not in this repository's history yet.
  if (!gitSucceeds(`diff --quiet -- ${STAMP_PATH}`) || !gitSucceeds(`diff --cached --quiet -- ${STAMP_PATH}`)) {
    console.error(
      `[stamp-build] ${STAMP_PATH} has uncommitted changes (build ${buildNumber}, ${sha}). `
      + 'Commit it so the number a build reports is one this repository actually records.',
    );
    process.exitCode = 1;
    return;
  }
  if (verdict.kind === 'unverifiable') {
    console.log(`[stamp-build] build ${buildNumber} (${sha}); provenance not checkable here (${verdict.reason}).`);
    return;
  }
  if (verdict.kind === 'behind') {
    console.log(
      `[stamp-build] build ${buildNumber} (${sha}) came from this history, ${verdict.behind} commit(s) behind HEAD. `
      + 'Run `npm run stamp` if this release should carry a newer number.',
    );
    return;
  }
  console.log(`[stamp-build] build ${buildNumber} (${sha}) is current with HEAD.`);
}

function write(): void {
  const prev = parseStamp(read());
  let stamped: ReturnType<typeof stampFromGit>;
  try {
    stamped = stampFromGit(git, prev);
  } catch (err) {
    console.error(`[stamp-build] ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }
  if (read() === stamped.json) {
    console.log(`[stamp-build] ${STAMP_PATH} already current: build ${stamped.info.buildNumber} (${stamped.info.sha}).`);
    return;
  }
  writeFileSync(STAMP_PATH, stamped.json);
  console.log(
    `[stamp-build] wrote ${STAMP_PATH}: build ${stamped.info.buildNumber}, `
    + `sha ${stamped.info.sha}, date ${stamped.info.date}. Commit it with the release.`,
  );
}

if (process.argv.includes('--check')) check(); else write();
