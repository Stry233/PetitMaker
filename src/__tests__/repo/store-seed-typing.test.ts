/**
 * A test may not seed the editor store through a cast, which type-checks anything and so hides a
 * renamed field. Seeds go through `__tests__/_support/store.ts:setStoreState`, whose
 * `Partial<EditorStore>` parameter makes a stale field a compile error. A deliberately invalid seed
 * carries `INVALID STORE SEED: <reason>` in a comment on or just above the call.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { repoFiles } from '../_support/source-graph';

// Vitest runs from the repo root.
const REPO = process.cwd();
const ROOT = 'src/__tests__';

/** This file holds the offending shapes as test data, so it cannot scan itself. */
const SELF = 'src/__tests__/repo/store-seed-typing.test.ts';

const ESCAPE = /INVALID STORE SEED:\s*\S+/;

/** Repo-relative POSIX paths of every source under `dir`, this file excepted. */
function walk(dir: string): string[] {
  return repoFiles(dir).filter((rel) => rel !== SELF);
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
    // The call's lines through its closing paren's line, plus the two lines above, so the marker
    // can sit on or above the call.
    const eol = src.indexOf('\n', match.index + call.length);
    const context = before.split('\n').slice(-3).join('\n')
      + src.slice(match.index, eol === -1 ? src.length : eol);
    if (ESCAPE.test(context)) continue;
    problems.push(
      `${file}:${line} seeds the editor store through a cast — use setStoreState() from `
      + '__tests__/_support/store.ts, which type-checks the field names (or, for a deliberately invalid '
      + 'value, mark the call `INVALID STORE SEED: <reason>`).',
    );
  }
  return problems;
}

describe('store seeds are type-checked', () => {
  it('catches the shapes a cast actually comes back in', () => {
    expect(scanSeeds('x.ts', "useEditorStore.setState({ locale: 'en' } as never);")).toHaveLength(1);
    expect(scanSeeds('x.ts', 'setStoreState({ selection: [] } as never);')).toHaveLength(1);
    // The cast sits on the last line of a multi-line seed.
    expect(scanSeeds('x.ts', "useEditorStore.setState({\n  locale: 'en',\n  selection: [],\n} as never);"))
      .toHaveLength(1);
    expect(scanSeeds('x.ts', 'useEditorStore.setState({ locale: 1 } as any);')).toHaveLength(1);
    expect(scanSeeds('x.ts', "setStoreState({ locale: 'en' });")).toEqual([]);
    expect(scanSeeds('x.ts', 'expect(rule.validate(cmd as never, state)).toHaveLength(0);')).toEqual([]);
  });

  it('lets a deliberately invalid seed through, but only with a reason', () => {
    const marked = 'setStoreState({ locale: 9 } as never); // INVALID STORE SEED: a bad locale must not crash';
    expect(scanSeeds('x.ts', marked)).toEqual([]);
    const above = '// INVALID STORE SEED: a bad locale must not crash\nsetStoreState({ locale: 9 } as never);';
    expect(scanSeeds('x.ts', above)).toEqual([]);
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
