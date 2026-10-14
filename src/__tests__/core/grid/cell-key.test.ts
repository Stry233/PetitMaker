/**
 * Production code builds the string key of an integer pair (a cell, a chunk, a point of another
 * lattice) through `core/grid/rect.ts:cellKey`, and of a fractional point through `quantisedKey`,
 * never as a hand-written `${x},${y}` template; `cellKey`'s own definition is the one template.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SRC, sourceFiles, srcRelative } from '../../_support/source-graph';
import { cellKey, chunkKey, parseCellKey, quantisedKey } from '../../../core/grid/rect';

const PAIR = /`\$\{[^{}`]+\},\$\{[^{}`]+\}`/g;

/** Each source holding a two-number template: its path, how many, and whether it defines cellKey. */
const found = sourceFiles(SRC).flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  const n = text.match(PAIR)?.length ?? 0;
  return n > 0 ? [{ path: `src/${srcRelative(file)}`, n, home: /export const cellKey = /.test(text) }] : [];
});

describe('cell keys', () => {
  it('spells a cell and a chunk as "x,y"', () => {
    expect(cellKey(3, -4)).toBe('3,-4');
    expect(chunkKey(1, 2)).toBe('1,2');
    expect(parseCellKey(cellKey(3, -4))).toEqual({ x: 3, y: -4 });
  });

  it('keys a fractional point by its rounding to the step', () => {
    expect(quantisedKey(0.5001, -1.2499, 4)).toBe('2,-5');
    expect(quantisedKey(10.4, 3.6, 1)).toBe(cellKey(10, 4));
  });

  it('builds no hand-written two-number key outside cellKey itself', () => {
    expect(found.filter((f) => f.home).map((f) => f.n), 'cellKey is defined as the one template').toEqual([1]);
    expect(found.filter((f) => !f.home).map((f) => `${f.path}: ${f.n}`), 'build the key with cellKey, chunkKey or quantisedKey').toEqual([]);
  });
});
