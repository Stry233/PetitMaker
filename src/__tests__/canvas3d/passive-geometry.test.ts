/**
 * Layer-number overlay geometry: one quad per labeled cell with UVs into the
 * chunk's shared label canvas (numbers drape terrain like the 2D raster
 * overlay, one draw per chunk).
 */
import { describe, it, expect } from 'vitest';
import { chunkNumberQuads } from '../../canvas/map3d/build/passive-geometry';
import { CHUNK_SIZE } from '../../core/model/constants';
import { TerrainType } from '../../core/model/types';
import type { GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

describe('chunkNumberQuads', () => {
  it('one UV-mapped quad per labeled cell, skipping hidden layers', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 2, 2, TerrainType.Mountain, 3);
    const all = chunkNumberQuads(s, 0, 0, new Set());
    expect(all.positions.length / 12).toBe(CHUNK_SIZE * CHUNK_SIZE); // every cell labeled
    expect(all.uvs.length / 8).toBe(CHUNK_SIZE * CHUNK_SIZE);
    const hidden = chunkNumberQuads(s, 0, 0, new Set([3]));
    expect(hidden.positions.length / 12).toBe(CHUNK_SIZE * CHUNK_SIZE - 1); // the elev-3 cell dropped
  });
});
