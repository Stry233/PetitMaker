/**
 * Which cells a layer-visibility toggle may re-tier: exactly those whose
 * elevation reaches the lowest toggled layer — the contract that keeps a
 * panel click from rebuilding the whole terrain layer.
 */
import { describe, it, expect } from 'vitest';
import { cellsAffectedByLayerToggle } from '../../canvas/map2d/layers/layer-visibility';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

describe('cellsAffectedByLayerToggle', () => {
  it('returns only cells at or above the lowest toggled layer', () => {
    const state = makeState(10, 10);
    setTerrain(state, 1, 1, TerrainType.Mountain, 1);
    setTerrain(state, 2, 2, TerrainType.Mountain, 3);
    setTerrain(state, 3, 3, TerrainType.Mountain, 5);

    const affected = cellsAffectedByLayerToggle(state, [3]);
    expect(affected).toEqual([{ x: 2, y: 2 }, { x: 3, y: 3 }]);
  });

  it('layer 0 covers every terrained cell, empty cells never appear', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 4, TerrainType.Water, 0);
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);

    const affected = cellsAffectedByLayerToggle(state, [0]);
    expect(affected).toEqual([{ x: 4, y: 4 }, { x: 5, y: 5 }]);
  });

  it('no toggled layers means no work', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    expect(cellsAffectedByLayerToggle(state, [])).toEqual([]);
  });
});
