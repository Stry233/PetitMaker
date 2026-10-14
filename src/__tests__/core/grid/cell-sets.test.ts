/**
 * `largestComponent`, pinned where it is actually reachable.
 *
 * The golden hashes cannot stand in for these: at their 64x64 scale the generator never reaches
 * `carveCrown`, so the function is called zero times and every hash stays green with the search
 * broken. It is called 42 times on a real-scale map, and it is the reason a terrace has one summit
 * rather than two, so it earns its own pins.
 */
import { describe, expect, it } from 'vitest';
import { componentCells, enclosedPieces, labelComponents, largestComponent, stepDistance } from '../../../core/grid/cell-sets';

const W = 10;
const idx = (x: number, y: number): number => y * W + x;

describe('largestComponent', () => {
  it('keeps the largest component, not the first one found', () => {
    // A 1-cell pocket before a 3-cell run in input order: a search that returned the first
    // component it completed would answer with the pocket.
    const island = [idx(1, 1)];
    const run = [idx(5, 5), idx(6, 5), idx(7, 5)];
    expect(largestComponent([...island, ...run], W).sort((a, b) => a - b)).toEqual(run);
  });

  it('walks all four orthogonal neighbours', () => {
    // A plus centred at (5,5): each arm is reachable only through one of the four steps, so a
    // dropped direction leaves the centre in a component of 4 instead of 5 and the answer becomes
    // one of the arms.
    const plus = [idx(5, 5), idx(4, 5), idx(6, 5), idx(5, 4), idx(5, 6)];
    expect(largestComponent(plus, W).length).toBe(5);
  });

  it('a diagonal touch is not a connection', () => {
    // 4-connected, so two cells meeting at a corner are two components of one.
    expect(largestComponent([idx(2, 2), idx(3, 3)], W).length).toBe(1);
  });

  it('a row end does not join the next row start', () => {
    // (W-1, 1) and (0, 2) are adjacent indices but opposite map edges.
    expect(largestComponent([idx(W - 1, 1), idx(0, 2)], W).length).toBe(1);
  });

  it('an empty set has no component', () => {
    expect(largestComponent([], W)).toEqual([]);
  });
});

describe('labelComponents', () => {
  it('splits set neighbours that joins refuses and numbers pieces in raster order', () => {
    const height = [1, 1, 2, 2, 1, 1];
    const { labels, sizes } = labelComponents(new Uint8Array(6).fill(1), 3, 2, false, (i, j) => height[i] === height[j]);
    expect(Array.from(labels)).toEqual([1, 1, 2, 3, 1, 1]);
    expect(sizes).toEqual([0, 4, 1, 1]);
  });
  const grid = (rows: string[]) => Uint8Array.from(rows.join('').split(''), (c) => (c === '#' ? 1 : 0));

  it('labels 4- and 8-connected components', () => {
    const m = grid(['#.#', '.#.', '#.#']);
    expect(labelComponents(m, 3, 3).sizes.length - 1).toBe(5);
    expect(labelComponents(m, 3, 3, true).sizes.length - 1).toBe(1);
  });

  it('lists each component\'s cells in raster order', () => {
    const { labels, sizes } = labelComponents(grid(['##.', '..#', '###']), 3, 3);
    expect(componentCells(labels, sizes.length - 1)).toEqual([[0, 1], [5, 6, 7, 8]]);
  });
});

describe('stepDistance', () => {
  it('is 0 at seeds and grows by BFS', () => {
    expect(Array.from(stepDistance([0], 5, 1))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('enclosedPieces', () => {
  it('counts the clear pieces the set cells wall off from the border', () => {
    // Three walled holes, and a bay open to the right border that is not one.
    const rows = ['#####', '#.#..', '#####', '#.#.#', '#####'];
    const mask = Uint8Array.from(rows.join(''), (ch) => (ch === '#' ? 1 : 0));
    expect(enclosedPieces(mask, 5, 5)).toBe(3);
    expect(enclosedPieces(new Uint8Array(9), 3, 3)).toBe(0);
  });
});
