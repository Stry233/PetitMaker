import { describe, expect, it } from 'vitest';
import { type Corners } from '../../../core/model/types';
import { CORNERS, CORNER_INDEX, cornersOnSide, copyCorners, mapCorners } from '../../../core/model/corners';
import { SIDES } from '../../../core/grid/directions';
import { INNER_TRI, OUTER_TRI } from '../../../core/domain/edge-cut/cut-validator';

describe('corner tuples', () => {
  it('copies a tuple into a new mutable array', () => {
    const source: Readonly<Corners> = ['fan', 'square', 'tri-SW', 'empty'];
    const copy = copyCorners(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
  });

  it('maps each corner in index order', () => {
    const seen: number[] = [];
    const out = mapCorners(['fan', 'square', 'empty', 'square'], (trim, index) => {
      seen.push(index);
      return trim === 'empty' ? 'square' : trim;
    });
    expect(out).toEqual(['fan', 'square', 'square', 'square']);
    expect(seen).toEqual([0, 1, 2, 3]);
  });
});

describe('corner adjacency', () => {
  it('pins the index convention and each corner\'s sides and neighbours', () => {
    expect(CORNERS.map((c) => [c.pos, c.compass, c.sides, c.edges, c.diagonal])).toEqual([
      ['TL', 'NW', ['N', 'W'], [[-1, 0], [0, -1]], [-1, -1]],
      ['TR', 'NE', ['N', 'E'], [[1, 0], [0, -1]], [1, -1]],
      ['BL', 'SW', ['S', 'W'], [[-1, 0], [0, 1]], [-1, 1]],
      ['BR', 'SE', ['S', 'E'], [[1, 0], [0, 1]], [1, 1]],
    ]);
    expect(CORNER_INDEX).toEqual({ TL: 0, TR: 1, BL: 2, BR: 3 });
  });

  it('lists the corners on each side in index order', () => {
    expect(SIDES.map((s) => cornersOnSide(s))).toEqual([[0, 1], [1, 3], [2, 3], [0, 2]]);
  });

  it('names the outer and inner triangles of each corner', () => {
    expect([0, 1, 2, 3].map((i) => OUTER_TRI[i])).toEqual(['tri-SE', 'tri-SW', 'tri-NE', 'tri-NW']);
    expect([0, 1, 2, 3].map((i) => INNER_TRI[i])).toEqual(['tri-NW', 'tri-NE', 'tri-SW', 'tri-SE']);
  });
});
