import { describe, it, expect } from 'vitest';
import { mountainLadder } from '../../../core/model/command-build';
import { DIRECTIONS } from '../../../core/grid/directions';

describe('mountainLadder', () => {
  it('raises each cell from its base to its top, one layer at a time, lowest first', () => {
    const cells = [{ x: 0, y: 0, base: 0, top: 3 }, { x: 1, y: 0, base: 2, top: 3 }, { x: 2, y: 0, base: 0, top: 1 }];
    const ladder = mountainLadder(cells, (c) => ({ x: c.x, y: c.y }), (c) => c.base, (c) => c.top);
    expect(ladder.map((c) => [c.elevation, c.cells.map((p) => p.x)])).toEqual([[1, [0, 2]], [2, [0]], [3, [0, 1]]]);
  });

  it('lists every compass direction once', () => {
    expect([...new Set(DIRECTIONS)]).toHaveLength(4);
  });
});
