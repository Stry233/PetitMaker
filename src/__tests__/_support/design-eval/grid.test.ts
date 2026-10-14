import { describe, expect, it } from 'vitest';
import { gapClusters } from './grid';

describe('gapClusters', () => {
  const mask = (rows: string[]) => Uint8Array.from(rows.join('').split(''), (c) => (c === '#' ? 1 : 0));

  it('joins cells within the gap on both axes and nothing farther, in raster order', () => {
    // (3,0) and (3,2) stand two apart and join; (0,0) is three from (3,0) and (8,0) five.
    const m = mask(['#..#....#', '.........', '...#.....']);
    const clusters = gapClusters(m, 9, 3, 2).map((c) => [...c].sort((a, b) => a - b));
    expect(clusters).toEqual([[0], [3, 21], [8]]);
  });
});
