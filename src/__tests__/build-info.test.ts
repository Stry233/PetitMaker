/**
 * The build number has ONE source: the committed `build-info.json`, stamped from the
 * repository that owns it. A build reads that file and nothing else.
 *
 * It used to be `git rev-list --count HEAD` read at build time, which is right only
 * inside the full-history private repo. Everywhere else it was wrong without saying
 * so: a shallow clone (CI's default checkout) counts the fetch depth, a tarball or
 * Docker COPY without `.git` fell back to 0, and the public-repo export carries a
 * fresh history that starts over at 1. These tests pin the properties that make the
 * number survive being copied, exported, shallow-cloned, and re-hosted.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import {
  STAMP_PATH, UNSTAMPED, buildInfoFromGit, checkStamp, parseStamp, resolveBuildInfo,
  resolveVersion, stampFromGit, unstampedMessage,
} from '../../scripts/build-info-core.mts';

const STAMP = JSON.stringify({ buildNumber: 1479, sha: 'd23c534e', date: '2026-07-25' });

/** A fake git: `answers` maps the argument string to stdout; anything else is null. */
function fakeGit(answers: Record<string, string>) {
  return (args: string) => answers[args] ?? null;
}
/** Exit-code form: succeeds for the listed argument strings. */
function fakeGitSucceeds(ok: string[]) {
  return (args: string) => ok.includes(args);
}

const FULL_HISTORY = fakeGit({
  'rev-parse --is-shallow-repository': 'false',
  'rev-parse --short HEAD': 'abc1234',
  'rev-list --count HEAD': '1500',
  'log -1 --format=%cs': '2026-07-28',
});
const SHALLOW = fakeGit({
  'rev-parse --is-shallow-repository': 'true',
  'rev-parse --short HEAD': 'abc1234',
  'rev-list --count HEAD': '1', // the fetch depth, not the history
  'log -1 --format=%cs': '2026-07-28',
});
/** What the public-repo export looks like: a real repository, one commit. */
const FRESH_HISTORY = fakeGit({
  'rev-parse --is-shallow-repository': 'false',
  'rev-parse --short HEAD': 'f00d123',
  'rev-list --count HEAD': '1',
  'log -1 --format=%cs': '2026-08-01',
});
const NO_GIT = fakeGit({});

describe('what a build reads', () => {
  it('takes the identity from the stamp', () => {
    const { info, stamped } = resolveBuildInfo({ readStamp: () => STAMP });
    expect(stamped).toBe(true);
    expect(info).toEqual({ buildNumber: '1479', sha: 'd23c534e', date: '2026-07-25' });
  });

  it('reads the stamp and NOTHING else — no env, no git, so a host cannot supply its own', () => {
    // The deps surface is the whole contract: if resolution ever grew another input,
    // a deployment could report a number this repository never produced.
    expect(Object.keys(resolveBuildInfo({ readStamp: () => STAMP })).sort()).toEqual(['info', 'stamped']);
    expect(resolveBuildInfo.length).toBe(1);
    const core = readFileSync('scripts/build-info-core.mts', 'utf8');
    const resolver = core.slice(core.indexOf('export function resolveBuildInfo'));
    const body = resolver.slice(0, resolver.indexOf('\n}'));
    expect(body).not.toMatch(/process\.env|PETIT_BUILD|git\(/);
  });

  it('treats a missing or malformed stamp as unstamped, never as a partial identity', () => {
    for (const bad of [null, '', '{', 'null', '{"buildNumber":0}', '{"buildNumber":-3}',
      '{"buildNumber":"1.2"}', '{"buildNumber":7}' /* no sha */, '{"sha":"zzz","buildNumber":7}']) {
      const { info, stamped } = resolveBuildInfo({ readStamp: () => bad });
      expect(stamped, `${bad} should not be trusted`).toBe(false);
      expect(info).toEqual(UNSTAMPED);
    }
  });

  it('says dev, never 0, when unstamped — and a production build is told to fail', () => {
    expect(UNSTAMPED.buildNumber).toBe('dev');
    expect(unstampedMessage(true)).toMatch(/must not invent one/);
    expect(unstampedMessage(false)).toMatch(/Showing "dev"/);
  });
});

describe('stamping is the only writer, and only in the owning repository', () => {
  it('records the count, sha and COMMIT date (not the build date) for a full history', () => {
    const { json, info } = stampFromGit(FULL_HISTORY);
    expect(info).toEqual({ buildNumber: '1500', sha: 'abc1234', date: '2026-07-28' });
    expect(JSON.parse(json).buildNumber).toBe(1500);
    expect(json.endsWith('\n')).toBe(true);
    // Round-trips through the reader that consumes it.
    expect(parseStamp(json)).toEqual({ buildNumber: '1500', sha: 'abc1234', date: '2026-07-28' });
  });

  it('refuses a history it cannot count', () => {
    expect(() => stampFromGit(SHALLOW)).toThrow(/shallow/);
    expect(() => stampFromGit(NO_GIT)).toThrow(/git is unavailable/);
  });

  it('refuses to LOWER the number, so a fresh or squashed history cannot clobber it', () => {
    // Running `npm run stamp` inside the public export (or after a squashing
    // migration) would otherwise replace 1479 with 1.
    expect(() => stampFromGit(FRESH_HISTORY, parseStamp(STAMP)))
      .toThrow(/refusing to lower the build number \(committed 1479, this history gives 1\)/);
    // Moving forward in the owning repository is fine.
    expect(stampFromGit(FULL_HISTORY, parseStamp(STAMP)).info.buildNumber).toBe('1500');
    // Equal is fine (re-stamping the same commit).
    expect(stampFromGit(FULL_HISTORY, { buildNumber: '1500' }).info.buildNumber).toBe('1500');
  });

  it('withholds a shallow clone\'s count but keeps its real sha', () => {
    const info = buildInfoFromGit(SHALLOW);
    expect(info.buildNumber).toBeUndefined();
    expect(info.sha).toBe('abc1234');
  });
});

describe('provenance: the committed number came from this history', () => {
  const ANCESTOR = fakeGitSucceeds(['cat-file -e d23c534e^{commit}', 'merge-base --is-ancestor d23c534e HEAD']);

  it('passes when the stamped commit is an ancestor of HEAD, reporting the distance', () => {
    const git = fakeGit({ 'rev-parse --short HEAD': 'abc1234', 'rev-list --count d23c534e..HEAD': '4' });
    const v = checkStamp(STAMP, git, ANCESTOR);
    expect(v).toMatchObject({ ok: true, kind: 'behind', behind: 4 });
  });

  it('reports current when HEAD is the stamped commit', () => {
    const git = fakeGit({ 'rev-parse --short HEAD': 'd23c534e', 'rev-list --count d23c534e..HEAD': '0' });
    expect(checkStamp(STAMP, git, ANCESTOR)).toMatchObject({ ok: true, kind: 'current', behind: 0 });
  });

  it('FAILS when the stamped commit is not an ancestor — the number came from elsewhere', () => {
    const git = fakeGit({ 'rev-parse --short HEAD': 'abc1234' });
    const v = checkStamp(STAMP, git, fakeGitSucceeds(['cat-file -e d23c534e^{commit}']));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/NOT an ancestor/);
  });

  it('cannot verify where the history is absent or unrelated, and says so instead of failing', () => {
    // A consumer of the number (public export, tarball) is not its owner.
    expect(checkStamp(STAMP, NO_GIT, fakeGitSucceeds([]))).toMatchObject({ ok: true, kind: 'unverifiable' });
    const unrelated = fakeGit({ 'rev-parse --short HEAD': 'f00d123' });
    expect(checkStamp(STAMP, unrelated, fakeGitSucceeds([]))).toMatchObject({ ok: true, kind: 'unverifiable' });
  });

  it('fails a missing or malformed stamp', () => {
    expect(checkStamp(null, FULL_HISTORY, fakeGitSucceeds([]))).toMatchObject({ ok: false });
    expect(checkStamp('{"buildNumber":0}', FULL_HISTORY, fakeGitSucceeds([]))).toMatchObject({ ok: false });
  });
});

describe('the committed stamp', () => {
  it('is present and valid, so any clone of this tree builds a real build number', () => {
    const parsed = parseStamp(readFileSync(STAMP_PATH, 'utf8'));
    expect(parsed.buildNumber, `${STAMP_PATH} has no usable buildNumber — run \`npm run stamp\``).toBeDefined();
    expect(Number(parsed.buildNumber)).toBeGreaterThan(0);
    expect(parsed.sha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(parsed.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/**
 * The version is `MAJOR.MINOR.BUILD`, PATCH being the build number, so a version carries the
 * same single source of truth as the stamp. `-dev` is decided by DATA: only a published
 * snapshot's stamp has `release`, so every build from the source repository is a dev build
 * and every build of a published snapshot is a release, with nothing to set per environment.
 */
describe('version numbering', () => {
  it('renders a dev version from the package series and the build number', () => {
    expect(resolveVersion({ pkgVersion: '0.1.0', buildNumber: '1485' })).toBe('0.1.1485-dev');
    expect(resolveVersion({ pkgVersion: '1.4.9', buildNumber: '2000' })).toBe('1.4.2000-dev');
  });

  it('drops -dev only when the stamp says the tree was published', () => {
    expect(resolveVersion({ pkgVersion: '0.1.0', buildNumber: '1485', release: '0.2.1485' }))
      .toBe('0.2.1485');
    // A malformed release marker is ignored rather than shown as a version.
    expect(resolveVersion({ pkgVersion: '0.1.0', buildNumber: '1485', release: 'nonsense' }))
      .toBe('0.1.1485-dev');
  });

  it('stays valid semver when the build number is unknown', () => {
    expect(resolveVersion({ pkgVersion: '0.1.0', buildNumber: 'dev' })).toBe('0.1.0-dev');
  });
});
