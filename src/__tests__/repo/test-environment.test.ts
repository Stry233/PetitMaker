/**
 * How the unit files split. A file runs in Node unless it opens with a `// @vitest-environment jsdom`
 * docblock, a file in a shared folder runs in a module graph it shares with the other files of its
 * worker unless it shows a sign of needing a fresh one, and a `.slow.` file runs in the slow tier
 * instead of `npm run test:run`.
 */
import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NEEDS_ISOLATION, SHARED_UNIT_FILES, SLOW, UNIT_EXCLUDE } from '../../../vitest.config';

const ROOT = resolve(__dirname, '../../..');
const UNIT = globSync(['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,tsx,mts}'], { cwd: ROOT })
  .map((p) => p.split('\\').join('/'))
  .filter((p) => !/\.e2e\./.test(p) && !p.startsWith('src/__tests__/perf/'));
const text = new Map(UNIT.map((p) => [p, readFileSync(join(ROOT, p), 'utf8') as string]));
const DOCBLOCK = /^\/\/ @vitest-environment (\S+)$/m;
/** Testing Library imports that render into a document; `act` alone runs anywhere. */
const RENDERS = /import\s*\{[^}]*\b(render|renderHook|screen|fireEvent|within|waitFor)\b[^}]*\}\s*from '@testing-library\/react'|from '@testing-library\/user-event'/;

describe('test environments', () => {
  it('declares an environment only as the first line, and only jsdom or node', () => {
    const offenders = UNIT.filter((p) => {
      const m = DOCBLOCK.exec(text.get(p)!);
      return m && (!['jsdom', 'node'].includes(m[1]!) || m.index !== 0);
    });
    expect(offenders).toEqual([]);
  });

  it('runs every file that renders through Testing Library in jsdom', () => {
    const offenders = UNIT.filter((p) => RENDERS.test(text.get(p)!) && DOCBLOCK.exec(text.get(p)!)?.[1] !== 'jsdom');
    expect(offenders).toEqual([]);
  });
});

describe('shared module graphs', () => {
  it('shares no file that declares jsdom, mocks a module, fakes the clock or touches the store', () => {
    expect(SHARED_UNIT_FILES.filter((p) => NEEDS_ISOLATION.test(text.get(p) ?? ''))).toEqual([]);
    expect(SHARED_UNIT_FILES.every((p) => text.has(p))).toBe(true);
  });

  it('keeps the editing tools, the editor layer, the view input layer and the UI isolated', () => {
    const interactive = /^src\/__tests__\/(editor|ui|view\/interaction|tools\/(?!generation\/|placement\/))/;
    expect(SHARED_UNIT_FILES.filter((p) => interactive.test(p))).toEqual([]);
  });
});

describe('test tiers', () => {
  const slow = UNIT.filter((p) => /\.slow\./.test(p));

  it('keeps the slow tier out of the fast projects and nowhere else', () => {
    expect(SLOW.every((glob) => UNIT_EXCLUDE.includes(glob))).toBe(true);
    expect(SHARED_UNIT_FILES.filter((p) => /\.slow\./.test(p))).toEqual([]);
    expect(slow.filter((p) => !globSync(SLOW, { cwd: ROOT }).map((q) => q.split('\\').join('/')).includes(p))).toEqual([]);
  });

  it('names a withheld slow test so the export still withholds it', () => {
    expect(UNIT.filter((p) => /\.internal\.slow\./.test(p))).toEqual([]);
  });
});
