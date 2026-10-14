/**
 * Test hooks carry a `__` prefix (`__reset*`, `__set*`): a hook resets or seeds module state for a
 * test, a test calls it, and no production module may. Every other runtime export of a layer
 * reaches production code, apart from the exports `repo/test-hooks-allowlist.json` lists, each with
 * its reason. A private development tool ships nothing, so its use keeps no shipped export alive.
 *
 * A file uses an export when one of its import edges resolves to the declaring module, through any
 * barrel's re-exports, and names it: a named binding names it directly; a file that reaches the
 * module whole (a namespace binding, a dynamic import, `vi.mock`) names it by mentioning it. A
 * same-named identifier in a file that does not import the module is no use.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO as ROOT, moduleBindings, repoRelative, resolveScript, sourceText, walkFiles } from '../_support/source-graph';
import LIST from './test-hooks-allowlist.json';
import { LAYERS } from '../../../scripts/layers.mts';
import { liteAliases } from '../../../scripts/edition-build.mts';

const ALLOWLIST: string[] = (LIST as { entries: { path: string }[] }).entries.map((e) => e.path);
/** Every layer folder of `src/`. */
const CHECKED = LAYERS.flat().filter((layer) => layer !== 'entry').map((layer) => `src/${layer}/`);
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class|enum)\s+([A-Za-z_$][\w$]*)/gm;

const SCRIPT_FILE = /\.(ts|tsx|mts|mjs|js)$/;
/** The build configuration reaches source modules as production does. */
const ROOT_CONFIGS = ['vite.config.ts', 'vitest.config.ts'].filter((f) => existsSync(join(ROOT, f)));
/** Research sources as git sees them: tracked or not yet added, never the ignored working output. */
function researchFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'research'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter((f) => f.length > 0 && SCRIPT_FILE.test(f.split('/').pop()!) && existsSync(join(ROOT, f))).map((f) => join(ROOT, f));
}

const files = [...walkFiles(join(ROOT, 'src'), { accept: SCRIPT_FILE }), ...walkFiles(join(ROOT, 'scripts'), { accept: SCRIPT_FILE }), ...researchFiles()]
  .map(repoRelative).concat(ROOT_CONFIGS);
const text = new Map(files.map((f) => [f, sourceText(join(ROOT, f))]));
const isTest = (f: string) => f.startsWith('src/__tests__/');
const isProduction = (f: string) => !isTest(f) && (f.startsWith('src/') || ROOT_CONFIGS.includes(f));
/** The public snapshot withholds private tools and internal tests, so their uses are absent there. */
const PRIVATE_TREE = existsSync(join(ROOT, 'scripts', 'internal'));
/** Tests, private tools and private research: a use from any keeps no shipped export alive. */
const isOffProduct = (f: string) => isTest(f) || f.startsWith('scripts/internal/') || f.startsWith('research/');

/** Comments name exports without using them. */
const COMMENT_RE = /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/.*$/gm;
const mentions = new Map([...text].map(([f, s]) => [f, new Set(s.replace(COMMENT_RE, '$1').match(/[A-Za-z_$][\w$]*/g) ?? [])]));

const declared = new Map([...text].map(([f, s]) => [f, new Set([...s.matchAll(EXPORT_RE)].map((m) => m[1]!))]));
const exportsOf = (f: string) => [...declared.get(f)!];

const resolved = (from: string, spec: string): string | null => {
  const target = resolveScript(join(ROOT, from), spec);
  return target && text.has(repoRelative(target)) ? repoRelative(target) : null;
};
const bindings = new Map(files.map((f) => [f, moduleBindings(join(ROOT, f), text.get(f))]));

/** The modules a specifier loads: the one it resolves to, and the Lite build's replacement when an
 *  alias of `scripts/edition-build.mts` matches it. */
const targetsOf = (from: string, spec: string): string[] => [resolved(from, spec), ...liteAliases
  .filter((a) => a.find.test(spec)).map((a) => repoRelative(a.replacement))].filter((t): t is string => !!t && text.has(t));

/** The declarations `name` exported from `file` stands for, through re-exports. */
function origins(file: string, name: string, seen = new Set<string>()): string[] {
  const key = `${file}:${name}`;
  if (seen.has(key)) return [];
  seen.add(key);
  if (declared.get(file)?.has(name)) return [key];
  const out: string[] = [];
  for (const r of bindings.get(file)?.reexports ?? []) {
    for (const target of targetsOf(file, r.spec)) {
      if (r.as === name) out.push(...origins(target, r.name, seen));
      else if (r.as === '*' && name !== 'default') out.push(...origins(target, name, seen));
    }
  }
  return out;
}

/** `file:name` of a declared export -> the other files that use it. */
const users = new Map<string, Set<string>>();
const addUse = (user: string, target: string, names: Iterable<string>): void => {
  for (const name of names) {
    for (const origin of origins(target, name)) {
      if (origin.startsWith(`${user}:`)) continue;
      if (!users.has(origin)) users.set(origin, new Set());
      users.get(origin)!.add(user);
    }
  }
};
const loaded = [...bindings].flatMap(([f, { uses }]) => uses.flatMap((use) => targetsOf(f, use.spec).map((target) => ({ f, use, target }))));
for (const { f, use, target } of loaded) addUse(f, target, use.names ?? mentions.get(f)!);
// A loader's callers name what they take from the module it loads; a loader no binding holds hands
// on every export.
for (const { f, use, target } of loaded.filter((l) => l.use.via !== null)) {
  if (use.via === '*') addUse(f, target, declared.get(target)!);
  for (const caller of users.get(`${f}:${use.via}`) ?? []) addUse(caller, target, mentions.get(caller)!);
}
const usersOf = (file: string, name: string): string[] => [...(users.get(`${file}:${name}`) ?? [])];

const productionFiles = files.filter((f) => isProduction(f) && f.startsWith('src/'));

describe('test hooks', () => {
  it('are never called from production code', () => {
    const offenders = productionFiles.flatMap((f) => exportsOf(f).filter((n) => n.startsWith('__'))
      .flatMap((n) => usersOf(f, n).filter(isProduction).map((u) => `${f}:${n} used by ${u}`)));
    expect(offenders).toEqual([]);
  });

  it('are called by a test', () => {
    const uncalled = productionFiles.flatMap((f) => exportsOf(f).filter((n) => n.startsWith('__'))
      .filter((n) => !usersOf(f, n).some(isTest)).map((n) => `${f}:${n}`));
    expect(uncalled, 'a hook no test calls is dead code').toEqual([]);
  });

  it('carry the prefix when only tests or private tools use an export', () => {
    const testOnly = productionFiles.filter((f) => CHECKED.some((m) => f.startsWith(m))).flatMap((f) =>
      exportsOf(f).filter((n) => !n.startsWith('__')).filter((n) => {
        const u = usersOf(f, n);
        return u.length > 0 && u.every(isOffProduct);
      }).map((n) => `${f}:${n}`));
    expect(testOnly.filter((e) => !ALLOWLIST.includes(e)), 'prefix the hook with __, move test machinery to _support, or list it with its reason').toEqual([]);
    // In the public snapshot an entry whose only users were withheld has no users at all, not stale ones.
    const unused = (e: string) => { const [f, n] = e.split(':'); return usersOf(f!, n!).length === 0; };
    expect(ALLOWLIST.filter((e) => !testOnly.includes(e) && (PRIVATE_TREE || !unused(e))), 'remove stale allowlist entries').toEqual([]);
  });

  it('list each entry once, in path order, with its own reason', () => {
    const entries = (LIST as { entries: { path: string; reason: string }[] }).entries;
    const paths = entries.map((e) => e.path);
    expect(paths, 'entries file by layer: keep them in path order').toEqual([...paths].sort());
    expect(paths.filter((p, i) => paths.indexOf(p) !== i)).toEqual([]);
    expect(entries.filter((e) => !e.reason?.trim()).map((e) => e.path)).toEqual([]);
  });
});
