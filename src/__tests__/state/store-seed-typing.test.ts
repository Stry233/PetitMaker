/**
 * A test may not seed the editor store through a cast.
 *
 * `useEditorStore.setState({ … } as never)` type-checks anything. When a store field is renamed,
 * every seed of it keeps compiling and keeps passing while asserting nothing about the field it
 * names, so a rename leaves `tsc` silent and grep the only way to finish it. Seeds go through
 * `__tests__/_store.ts:setStoreState`, whose `Partial<EditorStore>` parameter turns a stale field
 * name back into a compile error.
 *
 * The scan reads a call to the END of its argument list rather than to the end of the line: a seed
 * spanning several lines is the common shape, and the cast sits on the last of them.
 *
 * ESCAPE: a seed that deliberately installs an invalid value for a negative test is a legitimate
 * cast. Mark it with `INVALID STORE SEED: <reason>` in a comment on, or just above, the call. The
 * marker must carry a reason, so it cannot be pasted around as a silencer.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readdirSync, readFileSync, statSync } from 'node:fs';

// Minimal ambient shape for `process.cwd()` — this repo's convention for node globals in tests
// (see legal/repo-hygiene.test.ts). Vitest runs from the repo root.
declare const process: { cwd(): string };

const REPO = process.cwd();
const ROOT = 'src/__tests__';

/** This file holds the offending shapes as test DATA, so it cannot scan itself. */
const SELF = 'src/__tests__/state/store-seed-typing.test.ts';

/** The marker that exempts one call, plus the reason it must carry. */
const ESCAPE = /INVALID STORE SEED:\s*\S+/;

/** Repo-relative POSIX paths of every test source under `dir`. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(`${REPO}/${dir}`) as string[]) {
    const rel = `${dir}/${name}`;
    if (statSync(`${REPO}/${rel}`).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && rel !== SELF) out.push(rel);
  }
  return out;
}

/** Index just past the closing paren of a call whose arguments start at `from`. */
function callEnd(src: string, from: number): number {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return src.length;
}

/** Every store seed in one file that hides behind a cast, as a reader-facing line. */
export function scanSeeds(file: string, src: string): string[] {
  const problems: string[] = [];
  for (const match of src.matchAll(/(?:useEditorStore\.setState|setStoreState)\s*\(/g)) {
    const start = match.index + match[0].length;
    const call = src.slice(match.index, callEnd(src, start));
    if (!/\bas\s+(never|any|unknown)\b/.test(call)) continue;
    const before = src.slice(0, match.index);
    const line = before.split('\n').length;
    // The call's whole lines, out to the end of the one holding its closing paren (a trailing
    // comment lives there), plus the two lines above it, so the marker can sit on either side.
    const eol = src.indexOf('\n', match.index + call.length);
    const context = before.split('\n').slice(-3).join('\n')
      + src.slice(match.index, eol === -1 ? src.length : eol);
    if (ESCAPE.test(context)) continue;
    problems.push(
      `${file}:${line} seeds the editor store through a cast — use setStoreState() from `
      + '__tests__/_store.ts, which type-checks the field names (or, for a deliberately invalid '
      + 'value, mark the call `INVALID STORE SEED: <reason>`).',
    );
  }
  return problems;
}

describe('store seeds are type-checked', () => {
  it('catches the shapes a cast actually comes back in', () => {
    expect(scanSeeds('x.ts', "useEditorStore.setState({ locale: 'en' } as never);")).toHaveLength(1);
    expect(scanSeeds('x.ts', 'setStoreState({ selection: [] } as never);')).toHaveLength(1);
    // Multi-line: the cast is on neither the first line nor the same line as the call.
    expect(scanSeeds('x.ts', "useEditorStore.setState({\n  locale: 'en',\n  selection: [],\n} as never);"))
      .toHaveLength(1);
    // `as any` / `as unknown` reopen the same hole.
    expect(scanSeeds('x.ts', 'useEditorStore.setState({ locale: 1 } as any);')).toHaveLength(1);
    // …and no false positive on a typed seed, or on `as never` somewhere else entirely.
    expect(scanSeeds('x.ts', "setStoreState({ locale: 'en' });")).toEqual([]);
    expect(scanSeeds('x.ts', 'expect(rule.validate(cmd as never, state)).toHaveLength(0);')).toEqual([]);
  });

  it('lets a deliberately invalid seed through, but only with a reason', () => {
    const marked = 'setStoreState({ locale: 9 } as never); // INVALID STORE SEED: a bad locale must not crash';
    expect(scanSeeds('x.ts', marked)).toEqual([]);
    const above = '// INVALID STORE SEED: a bad locale must not crash\nsetStoreState({ locale: 9 } as never);';
    expect(scanSeeds('x.ts', above)).toEqual([]);
    // A bare marker with no reason silences nothing.
    expect(scanSeeds('x.ts', 'setStoreState({ locale: 9 } as never); // INVALID STORE SEED:')).toHaveLength(1);
  });

  it('scans a real, non-empty set of test sources', () => {
    const files = walk(ROOT);
    expect(files.length).toBeGreaterThan(150);
    expect(files.filter((f) => readFileSync(`${REPO}/${f}`, 'utf8').includes('setStoreState(')).length)
      .toBeGreaterThan(15);
  });

  it('finds no cast-hidden store seed anywhere under src/__tests__', () => {
    const problems: string[] = [];
    for (const file of walk(ROOT)) problems.push(...scanSeeds(file, readFileSync(`${REPO}/${file}`, 'utf8')));
    expect(problems.join('\n')).toBe('');
  });
});
