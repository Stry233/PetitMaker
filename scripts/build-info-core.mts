/**
 * Build identity (build number, commit sha, date). ONE source of truth: the
 * committed `build-info.json`, stamped from THIS repository's history.
 *
 * Deriving it per build (`git rev-list --count HEAD`) is right only inside the
 * full-history private repo, and quietly wrong everywhere else: a shallow clone (CI's
 * default checkout) counts the fetch depth, a source tarball or Docker `COPY` without
 * `.git` has no count at all, and the public-repo export carries a FRESH history that
 * starts over at 1. A build-time date has the same problem from the other side: it is
 * whenever the build ran, so two people building identical source disagree about which
 * build they have.
 *
 * So a BUILD never derives the identity — it only reads the stamp. Nothing else may
 * supply a number: no deploy-host environment variable, no local git, no default.
 * A number that did not come from this repository's history would not identify
 * anything, so a production build with no valid stamp FAILS instead of inventing
 * one, and a dev server says so rather than showing a plausible-looking 0.
 *
 * Git is used in exactly one place: `npm run stamp` (scripts/stamp-build.mts), which
 * writes the file from the private repo's history. It refuses to write a number it
 * cannot trust (no git, or a shallow clone whose count is the fetch depth) and
 * refuses to LOWER an existing number, so re-running it inside a truncated or
 * re-created history (the public export, a squashed migration) cannot clobber the
 * real number. `stamp:check` then verifies that the committed stamp's commit is an
 * ancestor of HEAD, which is what proves the number came from this history and not
 * from somewhere else.
 *
 * Pure: every effect (file read, git) is injected, so each context is unit-testable
 * — see `src/__tests__/build-info.test.ts`.
 */

export interface BuildInfo {
  buildNumber: string;
  sha: string;
  date: string;
  /** The version this snapshot was PUBLISHED as. Present only in a published snapshot:
   *  the publish workflow writes it, and its presence is what makes a build a release
   *  rather than a dev build (see `resolveVersion`). */
  release?: string;
  /** What the last publish put out, copied back into THIS repository by the publish workflow.
   *  Only a dev version reads it — see `resolveVersion`. */
  lastRelease?: { version: string; buildNumber: string };
}

export interface BuildInfoDeps {
  /** Raw `build-info.json` contents, or null when the file is absent. */
  readStamp: () => string | null;
}

export const STAMP_PATH = 'build-info.json';

/** What a build shows when there is no usable stamp. A production build never gets
 *  this far (it throws); dev and unit tests do, and 'dev' cannot be mistaken for a
 *  real build number the way '0' could. */
export const UNSTAMPED: BuildInfo = { buildNumber: 'dev', sha: 'dev', date: '' };

/** MAJOR.MINOR.PATCH, no pre-release part (the `-dev` suffix is added, never parsed in). */
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Parse a stamp file, tolerating anything malformed — a broken stamp must read as
 *  ABSENT (so the caller fails or warns), never as a partially-trusted identity. */
export function parseStamp(raw: string | null): Partial<BuildInfo> {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<BuildInfo> = {};
    if (typeof data.buildNumber === 'number' && Number.isInteger(data.buildNumber) && data.buildNumber > 0) {
      out.buildNumber = String(data.buildNumber);
    } else if (typeof data.buildNumber === 'string' && /^\d+$/.test(data.buildNumber)) {
      out.buildNumber = data.buildNumber;
    }
    if (typeof data.sha === 'string' && /^[0-9a-f]{7,40}$/.test(data.sha)) out.sha = data.sha;
    if (typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)) out.date = data.date;
    const last = data.lastRelease as { version?: unknown; buildNumber?: unknown } | undefined;
    if (last && typeof last === 'object'
        && SEMVER.test(String(last.version)) && /^\d+$/.test(String(last.buildNumber))) {
      out.lastRelease = { version: String(last.version), buildNumber: String(last.buildNumber) };
    }
    if (typeof data.release === 'string' && SEMVER.test(data.release)) out.release = data.release;
    return out;
  } catch {
    return {};
  }
}

/** True when git reports a shallow clone, whose commit count is the fetch depth
 *  rather than the history's length. */
export function isShallow(git: (args: string) => string | null): boolean {
  return git('rev-parse --is-shallow-repository') === 'true';
}

/** The identity git can vouch for in THIS tree. Only `npm run stamp` calls this;
 *  a build never does. The count is withheld for a shallow clone (its sha and
 *  commit date are still real, only the count is meaningless). */
export function buildInfoFromGit(git: (args: string) => string | null): Partial<BuildInfo> {
  const out: Partial<BuildInfo> = {};
  const sha = git('rev-parse --short HEAD');
  if (sha) out.sha = sha;
  const date = git('log -1 --format=%cs');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
  if (!isShallow(git)) {
    const count = git('rev-list --count HEAD');
    if (count && /^\d+$/.test(count) && count !== '0') out.buildNumber = count;
  }
  return out;
}

/**
 * The identity for a build: the stamp, or nothing. `stamped` is false when the file
 * is absent or malformed — the caller decides (production throws, dev warns), and
 * that decision is the only place a build without a real number is tolerated.
 */
export function resolveBuildInfo(deps: BuildInfoDeps): { info: BuildInfo; stamped: boolean } {
  const stamp = parseStamp(deps.readStamp());
  if (!stamp.buildNumber || !stamp.sha) return { info: UNSTAMPED, stamped: false };
  return {
    info: {
      buildNumber: stamp.buildNumber, sha: stamp.sha, date: stamp.date ?? '',
      ...(stamp.release ? { release: stamp.release } : {}),
      ...(stamp.lastRelease ? { lastRelease: stamp.lastRelease } : {}),
    },
    stamped: true,
  };
}

/**
 * The version string a build displays: `MAJOR.MINOR.BUILD`, with `-dev` unless this is a
 * published snapshot.
 *
 * A DEV build shows the version its tree WOULD be released as, marked `-dev`. That is the same
 * `nextReleaseVersion` a publish would compute, from the same inputs, so a dev build always sorts
 * ABOVE the release it descends from: MINOR advances on every sync, and the next sync's MINOR is
 * one past the last one's.
 *
 * It needs to know what was last published, which the source repository does not otherwise track
 * — the record lives in the PUBLIC repository's committed stamp. The publish workflow copies it
 * back here as `lastRelease`. Without it (before the first publish, or an older stamp) the version
 * falls back to package.json's own MAJOR.MINOR over the absolute build number; that is a valid
 * version but it can sort BELOW a release, which is the whole reason `lastRelease` exists.
 *
 * `-dev` is decided by data, not by configuration: only the publish workflow writes
 * `release` into a snapshot's stamp, so ANY build from the source repository is a dev
 * build and any build of a published snapshot is a release. Nothing has to be remembered
 * or set per environment.
 */
export function resolveVersion(opts: {
  pkgVersion: string; buildNumber: string; release?: string;
  lastRelease?: { version: string; buildNumber: string };
}): string {
  if (opts.release && SEMVER.test(opts.release)) return opts.release;
  if (opts.lastRelease && /^\d+$/.test(opts.buildNumber)) {
    try {
      return `${nextReleaseVersion(opts.pkgVersion, opts.buildNumber, {
        lastVersion: opts.lastRelease.version, lastBuildNumber: opts.lastRelease.buildNumber,
      })}-dev`;
    } catch {
      // Building a commit OLDER than the last publish; `nextReleaseVersion` refuses to count
      // backwards, and the fallback below is a truthful version for a tree that is behind.
    }
  }
  const [major = '0', minor = '0'] = opts.pkgVersion.split('.');
  // An unstamped build has no number to use as PATCH; 0 keeps the string valid semver.
  const patch = /^\d+$/.test(opts.buildNumber) ? opts.buildNumber : '0';
  return `${major}.${minor}.${patch}-dev`;
}

/** Version and source build recorded in the public repository's committed stamp. */
export interface SeriesState {
  /** The `release` recorded in the last published snapshot's stamp, if any. */
  lastVersion?: string;
  /** The build number that snapshot carried. */
  lastBuildNumber?: string;
}

/** Minor releases count builds in PATCH; explicit patches increment PATCH on the existing line. */
export function nextReleaseVersion(
  pkgVersion: string,
  buildNumber: string,
  state: SeriesState = {},
  kind: 'minor' | 'patch' = 'minor',
): string {
  if (kind !== 'minor' && kind !== 'patch') throw new Error(`Unknown release kind: ${kind}`);
  if (!/^\d+$/.test(buildNumber)) {
    throw new Error(`cannot compute a release version without a build number (got "${buildNumber}")`);
  }
  const major = Number(pkgVersion.replace(/^v/, '').split('.')[0]);
  if (!Number.isInteger(major)) {
    throw new Error(`cannot read a MAJOR from package.json's version "${pkgVersion}"`);
  }
  const previous = /^(\d+)\.(\d+)\.(\d+)$/.exec(state.lastVersion ?? '');
  if (kind === 'patch' && (!previous || !/^\d+$/.test(state.lastBuildNumber ?? ''))) {
    throw new Error('A patch release requires a previous published version and build number');
  }
  if (!previous) return `${major}.1.${buildNumber}`; // first sync: no previous one to count from

  const lastMajor = Number(previous[1]), lastMinor = Number(previous[2]);
  const lastBuild = /^\d+$/.test(state.lastBuildNumber ?? '') ? Number(state.lastBuildNumber) : 0;
  const since = Number(buildNumber) - lastBuild;
  if (since < 0) {
    throw new Error(
      `refusing to release build ${buildNumber} after build ${lastBuild}: `
      + 'the last published snapshot is newer than this one',
    );
  }
  if (kind === 'patch') {
    if (major !== lastMajor) throw new Error('A patch release must keep the published major version');
    return `${major}.${lastMinor}.${Number(previous[3]) + 1}`;
  }
  // A newly declared MAJOR opens its line at X.0; otherwise the sync count advances.
  return major === lastMajor ? `${major}.${lastMinor + 1}.${since}` : `${major}.0.${since}`;
}

/** The newest `vMAJOR.MINOR.PATCH` among git tags, or '' when there is none. Ordering is
 *  numeric per component, so v0.10.x sorts after v0.9.x (a string sort would not). */
export function latestVersionTag(tags: readonly string[]): string {
  const parsed = tags
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .map((t) => ({ t, parts: t.slice(1).split('.').map(Number) as [number, number, number] }));
  if (parsed.length === 0) return '';
  parsed.sort((a, b) => a.parts[0] - b.parts[0] || a.parts[1] - b.parts[1] || a.parts[2] - b.parts[2]);
  return parsed[parsed.length - 1]!.t;
}

/** The message a build shows/throws when the stamp is missing — one wording for the
 *  dev warning and the production failure. */
export function unstampedMessage(production: boolean): string {
  return `[build-info] ${STAMP_PATH} is missing or invalid, so this build has no real build number.`
    + (production
      ? ' A production build must not invent one: run `npm run stamp` in the private repo and commit the result.'
      : ' Showing "dev". Run `npm run stamp` to get a real one.');
}

/**
 * The stamp file's contents for the CURRENT git tree. Throws rather than writing a
 * number it cannot vouch for.
 *
 * `previous` is the stamp already committed. A new number must never be LOWER than
 * it: a lower count means this history is not the one that produced the number (a
 * fresh-history export, a squashed migration, a shallow clone that slipped past the
 * check), and stamping there would replace the real identity with a meaningless
 * small one. Refusing keeps the private repo the only writer no matter where the
 * command is run by mistake.
 */
export function stampFromGit(
  git: (args: string) => string | null,
  previous: Partial<BuildInfo> = {},
): { json: string; info: BuildInfo } {
  const head = git('rev-parse --short HEAD');
  if (!head) {
    throw new Error('cannot stamp: git is unavailable or this is not a repository with commits');
  }
  if (isShallow(git)) {
    throw new Error('cannot stamp: shallow clone — the commit count would be the fetch depth (run `git fetch --unshallow`)');
  }
  const info = buildInfoFromGit(git);
  if (!info.buildNumber) throw new Error('cannot stamp: git returned no commit count');
  const prev = previous.buildNumber ? Number(previous.buildNumber) : 0;
  const next = Number(info.buildNumber);
  if (prev && next < prev) {
    throw new Error(
      `refusing to lower the build number (committed ${prev}, this history gives ${next}): `
      + 'this is not the history that produced the committed stamp. Stamp only in the repository that owns the build number.',
    );
  }
  const full: BuildInfo = {
    buildNumber: info.buildNumber, sha: info.sha ?? head, date: info.date ?? '',
    // CARRIED, not recomputed: stamping answers "which commit is this", and what was last
    // published is a different fact that only the publish workflow learns. Rewriting the stamp
    // without it would drop the record on the next build — including the dev site's, which
    // stamps in its own runner.
    ...(previous.lastRelease ? { lastRelease: previous.lastRelease } : {}),
  };
  const json = `${JSON.stringify({
    '//': 'GENERATED by `npm run stamp` from this repository\'s git history — the ONE source of the build number. Every build (any host, any clone depth, no git at all) reads this file; see scripts/build-info-core.mts.',
    buildNumber: Number(full.buildNumber),
    sha: full.sha,
    date: full.date,
    ...(full.lastRelease ? { lastRelease: full.lastRelease } : {}),
  }, null, 2)}\n`;
  return { json, info: full };
}

export type StampVerdict =
  | { ok: true; kind: 'current' | 'behind'; behind: number; stamp: BuildInfo }
  | { ok: true; kind: 'unverifiable'; reason: string; stamp: BuildInfo }
  | { ok: false; reason: string };

/**
 * Verify the committed stamp against this repository. The hard requirement is
 * PROVENANCE: the stamped commit must be an ancestor of HEAD, which is what proves
 * the number was produced by this history rather than injected from elsewhere. How
 * far HEAD has moved since is reported, not enforced — the number identifies the
 * release it was cut for, so being behind is information for the maintainer, and
 * requiring equality would be unsatisfiable (committing the stamp itself moves HEAD).
 *
 * Where the stamped commit is simply unknown to the local repository (the public
 * export's fresh history, a tarball with no git), provenance cannot be checked here
 * at all; that is reported as `unverifiable` rather than failed, since those trees
 * are consumers of the number, not owners of it.
 */
export function checkStamp(
  raw: string | null,
  git: (args: string) => string | null,
  gitSucceeds: (args: string) => boolean,
): StampVerdict {
  const stamp = parseStamp(raw);
  if (!stamp.buildNumber || !stamp.sha) {
    return { ok: false, reason: `${STAMP_PATH} is missing or malformed — run \`npm run stamp\`` };
  }
  const full: BuildInfo = { buildNumber: stamp.buildNumber, sha: stamp.sha, date: stamp.date ?? '' };
  if (!git('rev-parse --short HEAD')) {
    return { ok: true, kind: 'unverifiable', reason: 'no git history here', stamp: full };
  }
  if (!gitSucceeds(`cat-file -e ${full.sha}^{commit}`)) {
    return { ok: true, kind: 'unverifiable', reason: `commit ${full.sha} is not in this repository`, stamp: full };
  }
  if (!gitSucceeds(`merge-base --is-ancestor ${full.sha} HEAD`)) {
    return {
      ok: false,
      reason: `${STAMP_PATH} names commit ${full.sha}, which is NOT an ancestor of HEAD — `
        + 'the build number did not come from this history',
    };
  }
  const behind = Number(git(`rev-list --count ${full.sha}..HEAD`) ?? '0');
  return { ok: true, kind: behind === 0 ? 'current' : 'behind', behind, stamp: full };
}
