import { describe, it, expect } from 'vitest';
import { makeField, makeScratchState } from '../../../tools/generation/field';
import { NEIGHBORS4 } from '../../../core/model/grid-model';
import { makeState } from '../../rules/_helpers';
import { CellZone } from '../../../core/model/types';

describe('field helpers', () => {
  const at = (f: { width: number }, x: number, y: number): number => y * f.width + x;

  it('makeField masks to grass cells', () => {
    const s = makeState(8, 8);
    s.cells[0]![0]!.zone = CellZone.Void; // makeState is all-grass by default
    const f = makeField(s);
    expect(f.width).toBe(8); expect(f.height).toBe(8);
    expect(f.grass[at(f, 0, 0)]).toBe(0);
    expect(f.grass[at(f, 3, 3)]).toBe(1);
  });
  it('masks out the up-left bleed neighbourhood of a non-grass cell', () => {
    const s = makeState(8, 8); s.cells[0]![0]!.zone = CellZone.Void;
    const f = makeField(s);
    // void at (0,0) + its right/down/down-right neighbours (1,0),(0,1),(1,1) are excluded: a terrain
    // block bleeds -HALF up-left, so makeField drops grass cells whose up/left/up-left neighbour is
    // non-grass — (1,1)'s up-left is the void at (0,0).
    let grassN = 0;
    for (let i = 0; i < f.grass.length; i++) if (f.grass[i] === 1) grassN++;
    expect(grassN).toBe(8 * 8 - 4);
    expect(NEIGHBORS4).toHaveLength(4);
  });
  it('makeScratchState yields an all-grass GridState (no plaza for a 0x0-plaza template)', () => {
    const s = makeState(8, 8);
    const scratch = makeScratchState(s.template);
    expect(scratch.cells.length).toBe(8);
    expect(scratch.objects.size).toBe(0); // makeState's template has a 0x0 plaza → createPlazaObject returns null
  });
});
