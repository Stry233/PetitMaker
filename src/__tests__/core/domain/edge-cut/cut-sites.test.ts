import { describe, it, expect } from 'vitest';
import { gammaTier, outerCutSites } from '../../../../core/domain/edge-cut/cut-sites';
import { TerrainType } from '../../../../core/model/types';
import { roadLookup } from '../../../../state/object-index';
import { makeState, setTerrain } from '../../../_support/map-state';

const corners = [0, 1, 2, 3];

describe('outerCutSites', () => {
  it('offers every free convex corner of a lone block, and none a same-tier neighbour pins', () => {
    const state = makeState(12, 12);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    expect(corners.map(outerCutSites(state, roadLookup(state), 5, 5))).toEqual(['block', 'block', 'block', 'block']);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    expect(corners.map(outerCutSites(state, roadLookup(state), 5, 5))).toEqual(['block', null, 'block', null]);
  });

  it('offers an islet cut on ground poking into water, and nothing on a from-empty fillet', () => {
    const state = makeState(12, 12);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) if (x !== 5 || y !== 5) setTerrain(state, x, y, TerrainType.Water, 0);
    expect(corners.map(outerCutSites(state, roadLookup(state), 5, 5))).toEqual(['islet', 'islet', 'islet', 'islet']);
    state.cells[8]![8]!.terrain = { type: TerrainType.Mountain, elevation: 2, patchOnly: true, patchBase: 0, corners: ['fan', 'empty', 'empty', 'empty'] };
    expect(corners.map(outerCutSites(state, roadLookup(state), 8, 8))).toEqual([null, null, null, null]);
  });
});

describe('gammaTier', () => {
  it('lands at the shorter of two unequal walls, searched down from the tallest', () => {
    const state = makeState(12, 12);
    setTerrain(state, 4, 4, TerrainType.Mountain, 3);
    setTerrain(state, 4, 5, TerrainType.Mountain, 3);
    setTerrain(state, 5, 4, TerrainType.Mountain, 2);
    expect(gammaTier(state, 5, 5, 0, { type: TerrainType.Mountain, top: 3, floor: 0 })).toBe(2);
    expect(gammaTier(state, 5, 5, 0, { type: TerrainType.Mountain, top: 3, floor: 2 })).toBe(0);
    expect(gammaTier(state, 5, 5, 3, { type: TerrainType.Mountain, top: 3, floor: 0 })).toBe(0);
  });
});
