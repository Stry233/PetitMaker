import { describe, it, expect } from 'vitest';
import { seedShots, addShot, deleteShot, replaceShot, MAX_SHOTS, MIN_SHOTS } from '../../canvas/map3d/shot-list';
import { makeState, setTerrain } from '../rules/_helpers';
import { TerrainType, type GridState } from '../../core/model/types';

function relief(w = 40, h = 40): GridState {
  const s = makeState(w, h);
  for (let y = 6; y < 14; y++) for (let x = 6; x < 14; x++) setTerrain(s, x, y, TerrainType.Mountain, 6);
  setTerrain(s, 10, 10, TerrainType.Mountain, 8);
  return s;
}

describe('shot-list reducer', () => {
  it('seeds 4 shots', () => {
    expect(seedShots(relief())).toHaveLength(4);
  });

  it('add appends and caps at MAX_SHOTS', () => {
    const s = relief();
    let sh = seedShots(s);
    while (sh.length < MAX_SHOTS) sh = addShot(sh, s);
    expect(sh).toHaveLength(MAX_SHOTS);
    expect(addShot(sh, s)).toHaveLength(MAX_SHOTS); // no-op at cap
  });

  it('delete removes and floors at MIN_SHOTS', () => {
    let sh = seedShots(relief());
    while (sh.length > MIN_SHOTS) sh = deleteShot(sh, 0);
    expect(sh).toHaveLength(MIN_SHOTS);
    expect(deleteShot(sh, 0)).toHaveLength(MIN_SHOTS); // no-op at floor
  });

  it('replace sets only the target index', () => {
    const sh = seedShots(relief());
    const out = replaceShot(sh, 1, { az: 12, el: 34, dist: 0.7 });
    expect(out[1]).toEqual({ az: 12, el: 34, dist: 0.7 });
    expect(out[0]).toEqual(sh[0]);
    expect(out[2]).toEqual(sh[2]);
  });
});
