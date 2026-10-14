/** The planet-scan pipeline uses the shared cell-set, median, colour and blur helpers instead of private copies. */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { SRC, srcRelative, sourceText, walkFiles } from '../../_support/source-graph';

const NEIGHBOUR = String.raw`[-+]\s*(?:w|W|width|cols|stride)\b`;

/** What a private copy looks like, by name where the name is the helper's and by shape where any name would do. */
const COPIES: Record<string, RegExp> = {
  // A function named for a shared helper.
  name: /\bfunction\s+(?:floodFill|floodFrom|labelComponents|connectedComponents|stepDistance|srgbToLinear|linearToSrgb|luma|median(?:Of|InPlace)?)\b/,
  // A grid walk that pops a stack or queue and steps to a row neighbour (`core/grid/cell-sets.ts:floodFrom`).
  flood: new RegExp(String.raw`(?:while\s*\([^)]*\)|for\s*\([^;]*;[^;]*\.length;[^)]*\))\s*\{[^}]*?(?:\[--\w+\]|\.pop\(\)|\.shift\(\)|\[\w+\+\+\]|\w+\.push\()[^}]*?${NEIGHBOUR}`),
  // A two-pass chamfer distance, one `+ 1` per neighbour (`cell-sets.ts:stepDistance`).
  chamfer: /Math\.min\([^;]*?\+\s*1\s*,[^;]*?\+\s*1\s*,[^;]*?\+\s*1/,
  // A median read off sorted values (`core/base/math.ts:median`).
  sortMedian: /\.sort\([^)]*\)[\s\S]{0,200}?(?:length\s*>>\s*1|length\s*\/\s*2|length\s*-\s*1\)\s*\/\s*2)/,
};

/** Helpers `ground/raster.ts` owns, and the shapes of them only it may hold. */
const OWNED: Record<string, RegExp> = {
  name: /\bfunction\s+(?:blur|gaussianBlur|convolve\w*|reflect\w*)\b/,
  reflect: /2\s*\*\s*\(\s*\w+\s*-\s*1\s*\)\s*-\s*\w+|2\s*\*\s*\w+\s*-\s*2\s*-\s*\w+/,
};
const OWNER = 'pipelines/planet-scan/ground/raster.ts';

const copiesIn = (text: string, shapes: Record<string, RegExp>): string[] => Object.keys(shapes).filter((k) => shapes[k]!.test(text));

describe('planet-scan shared helpers', () => {
  it('defines no private copy of a shared helper', () => {
    const files = walkFiles(join(SRC, 'pipelines/planet-scan')).map(srcRelative);
    const copies = files.flatMap((f) => {
      const text = sourceText(join(SRC, f));
      const found = [...copiesIn(text, COPIES), ...(f === OWNER ? [] : copiesIn(text, OWNED))];
      return found.map((k) => `${f}: ${k}`);
    });
    expect(copies).toEqual([]);
  });

  it.each([
    ['a border-seeded stack flood', 'flood', `while (top > 0) {
    const i = stack[--top]!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (i < (h - 1) * w) seed(i + w);
  }`],
    ['a queue walk', 'flood', `for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    if (i >= cols && !seen[i - cols]) queue.push(i - cols);
  }`],
    ['a chamfer distance', 'chamfer', 'd[i] = Math.min(d[i]!, at(x - 1, y) + 1, at(x - 1, y - 1) + 1, at(x, y - 1) + 1);'],
    ['a sorted median', 'sortMedian', `const sorted = Float64Array.from(values).sort();
  const m = sorted.length >> 1;`],
    ['an upper median', 'sortMedian', 'scales.sort((p, q) => p - q);\n  return scales[Math.floor(scales.length / 2)]!;'],
    ['a renamed median', 'name', 'function medianOf(values: Float64Array): number {'],
  ])('recognises %s', (_, shape, text) => {
    expect(copiesIn(text, COPIES)).toContain(shape);
  });

  it.each([
    ['an index reflection', 'while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;'],
    ['the reflection written per sample', 'while (j < 0 || j >= n) j = j < 0 ? -j : 2 * (n - 1) - j;'],
  ])('recognises %s outside the raster owner', (_, text) => {
    expect(copiesIn(text, OWNED)).toContain('reflect');
  });
});
