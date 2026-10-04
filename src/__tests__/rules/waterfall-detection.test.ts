import { describe, it, expect } from 'vitest';
import { detectWaterfalls } from '../../core/model/waterfall-geometry';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain } from './_helpers';

describe('Waterfall Detection', () => {
  it('returns empty for a map with no water', () => {
    expect(detectWaterfalls(makeState())).toHaveLength(0);
  });

  it('returns empty for enclosed river at elevation 0', () => {
    const state = makeState();
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Water, 0);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    expect(detectWaterfalls(state)).toHaveLength(0);
  });

  it('detects a simple south-flowing waterfall', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    const waterfalls = detectWaterfalls(state);
    expect(waterfalls.length).toBeGreaterThan(0);
    expect(waterfalls.flatMap(w => w.faces).some(f => f.flowDirection === 'south')).toBe(true);
  });

  it('returns empty for cross-pattern (all sides blocked)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    expect(detectWaterfalls(state)).toHaveLength(0);
  });
});

describe('Waterfall detection: a water row in a mountain block', () => {
  // Top-view at elev 2:
  // M M M M M M
  // M M M M M M
  // M W W W W M  ← water should have south-flowing waterfall face
  it('detects south-flowing waterfall after painting water row', () => {
    const state = makeState(10, 10);
    for (let y = 2; y <= 4; y++)
      for (let x = 2; x <= 7; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);
    for (let x = 3; x <= 6; x++)
      setTerrain(state, x, 4, TerrainType.Water, 2);

    const waterfalls = detectWaterfalls(state);
    const southFaces = waterfalls.flatMap(w => w.faces).filter(f => f.flowDirection === 'south');
    expect(southFaces.length).toBeGreaterThan(0);
  });
});
