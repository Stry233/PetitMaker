/**
 * Layer-number overlay geometry: one quad per labeled cell with UVs into the
 * chunk's shared label canvas (numbers drape terrain like the 2D raster
 * overlay, one draw per chunk).
 */
import { describe, it, expect } from 'vitest';
import { chunkNumberQuads } from '../../../../view/map3d/geometry/passive-geometry';
import { TerrainType } from '../../../../core/model/types';
import type { GridState } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';
import { BUCKET_SIZE } from '../../../../core/grid/buckets';

describe('chunkNumberQuads', () => {
  it('one UV-mapped quad per labeled cell, skipping hidden layers', () => {
    const s = makeState(20, 20) as GridState;
    setTerrain(s, 2, 2, TerrainType.Mountain, 3);
    const all = chunkNumberQuads(s, 0, 0, new Set());
    expect(all.positions.length / 12).toBe(BUCKET_SIZE * BUCKET_SIZE); // every cell labeled
    expect(all.uvs.length / 8).toBe(BUCKET_SIZE * BUCKET_SIZE);
    const hidden = chunkNumberQuads(s, 0, 0, new Set([3]));
    expect(hidden.positions.length / 12).toBe(BUCKET_SIZE * BUCKET_SIZE - 1); // the elev-3 cell dropped
  });
});
