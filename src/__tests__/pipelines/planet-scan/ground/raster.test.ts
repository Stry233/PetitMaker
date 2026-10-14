import { describe, expect, it } from 'vitest';
import { chessboardDistance, close, componentsTouching, erode, fillHoles, largestComponent } from '../../../../pipelines/planet-scan/ground/raster';

const grid = (rows: string[]) => Uint8Array.from(rows.join('').split(''), (c) => (c === '#' ? 1 : 0));
const show = (m: Uint8Array, w: number) => Array.from({ length: m.length / w }, (_, r) => Array.from(m.subarray(r * w, r * w + w), (v) => (v ? '#' : '.')).join(''));

describe('raster operations', () => {
  it('fills only holes that do not reach the border', () => {
    const m = grid(['#####.', '#...#.', '#####.', '......']);
    expect(show(fillHoles(m, 6, 4), 6)).toEqual(['#####.', '#####.', '#####.', '......']);
  });

  it('keeps the largest component and the components touching seeds', () => {
    const m = grid(['##..#', '##..#', '.....']);
    expect(show(largestComponent(m, 5, 3), 5)).toEqual(['##...', '##...', '.....']);
    expect(show(componentsTouching(m, grid(['.....', '....#', '.....']), 5, 3, false), 5)).toEqual(['....#', '....#', '.....']);
  });

  it('closes gaps narrower than the square and erodes from the border', () => {
    const m = grid(['......', '.##.#.', '.##.#.', '......']);
    expect(show(close(m, 6, 4, 1), 6)).toEqual(['......', '.####.', '.####.', '......']);
    expect(erode(grid(['###', '###', '###']), 3, 3, 1)).toEqual(grid(['...', '.#.', '...']));
  });

  it('measures chessboard distance to the nearest clear cell', () => {
    const d = chessboardDistance(grid(['#####', '#####', '#####', '#####', '.####']), 5, 5);
    expect(d[4 * 5]).toBe(0);
    expect(d[0]).toBe(4);
    expect(d[3 * 5 + 1]).toBe(1);
  });
});
