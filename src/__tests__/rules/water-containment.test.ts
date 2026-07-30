import { describe, it, expect } from 'vitest';
import { waterContainmentRule } from '../../rules/water-containment';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain } from './_helpers';

describe('V-WTR-02: Water Containment', () => {
  it('allows river enclosed by mountains on all sides', () => {
    const state = makeState(10, 10);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) setTerrain(state, 5, 5, TerrainType.Water, 0);
        else setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
      }
    expect(waterContainmentRule.validate(state)).toHaveLength(0);
  });

  it('allows waterfall capped by mountains on both perpendicular ends', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    expect(waterContainmentRule.validate(state)).toHaveLength(0);
  });

  it('rejects waterfall uncapped on one side', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    expect(waterContainmentRule.validate(state).length).toBeGreaterThan(0);
  });

  it('rejects single elevated water with no mountain caps', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    expect(waterContainmentRule.validate(state).length).toBeGreaterThan(0);
  });

  it('allows wide waterfall strip capped on both ends', () => {
    const state = makeState(10, 10);
    setTerrain(state, 3, 5, TerrainType.Mountain, 1);
    setTerrain(state, 4, 5, TerrainType.Water, 1);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    setTerrain(state, 6, 5, TerrainType.Water, 1);
    setTerrain(state, 7, 5, TerrainType.Mountain, 1);
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    setTerrain(state, 6, 4, TerrainType.Mountain, 1);
    expect(waterContainmentRule.validate(state)).toHaveLength(0);
  });

  it('rejects water at map edge (out of bounds is not mountain)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 0, 5, TerrainType.Water, 1);
    setTerrain(state, 0, 4, TerrainType.Mountain, 1);
    setTerrain(state, 0, 6, TerrainType.Mountain, 1);
    expect(waterContainmentRule.validate(state).length).toBeGreaterThan(0);
  });
});
