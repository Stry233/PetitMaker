/**
 * The per-corner Γ-patch split shared by the 2D terrain layer and the 3D bevel
 * path: a wrapped corner renders as a fillet at the cosmetic tier, an unwrapped
 * cut as an outer bevel on the real base, and empty corners fold into the base.
 */
import { describe, it, expect } from 'vitest';
import { patchCornerSplit } from '../../core/edge-cut/patch-corners';
import { TerrainType } from '../../core/model/types';
import type { TerrainCell } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

describe('patchCornerSplit', () => {
  it('wrapped corner becomes a fillet; the base under it reads square', () => {
    const state = makeState(10, 10);
    // An L of elevation-3 mountain wraps the TL corner of (5,5).
    setTerrain(state, 4, 5, TerrainType.Mountain, 3);
    setTerrain(state, 5, 4, TerrainType.Mountain, 3);
    setTerrain(state, 4, 4, TerrainType.Mountain, 3);
    const patch: TerrainCell = {
      type: TerrainType.Mountain, elevation: 3, patchOnly: true, patchBase: 2,
      corners: ['fan', 'square', 'square', 'tri-SE'],
    };
    const split = patchCornerSplit(state, 5, 5, patch);
    expect(split.baseTier).toBe(2);
    expect(split.filletCorners[0]).toBe('fan');      // wrapped TL renders at tier 3
    expect(split.baseCorners[0]).toBe('square');     // the base under the fillet is full
    expect(split.filletCorners[3]).toBe('empty');    // unwrapped BR carries no fillet
    expect(split.baseCorners[3]).toBe('tri-SE');     // it is a genuine outer bevel of the base
  });

  it('empty corners fold into a full base', () => {
    const state = makeState(10, 10);
    const patch: TerrainCell = {
      type: TerrainType.Mountain, elevation: 2, patchOnly: true, patchBase: 1,
      corners: ['empty', 'empty', 'empty', 'empty'],
    };
    const split = patchCornerSplit(state, 5, 5, patch);
    expect(split.baseCorners).toEqual(['square', 'square', 'square', 'square']);
    expect(split.filletCorners).toEqual(['empty', 'empty', 'empty', 'empty']);
  });
});
