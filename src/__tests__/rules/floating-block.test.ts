import { describe, it, expect } from 'vitest';
import { mountainFloatingRule, waterFloatingRule } from '../../rules/floating-block';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain, paintCmd } from './_helpers';

describe('V-MTN-02: No Floating Mountain', () => {
  it('allows mountain at elevation 1 (ground support)', () => {
    expect(mountainFloatingRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1), makeState())).toHaveLength(0);
  });
  it('allows mountain at elevation 3 with elevation 2 below', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    expect(mountainFloatingRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 3), state)).toHaveLength(0);
  });
  it('rejects mountain at elevation 3 with nothing below', () => {
    expect(mountainFloatingRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 3), makeState())).toHaveLength(1);
  });
  it('allows mountain at elevation 2 over water at elevation 1 (water IS terrain)', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    expect(mountainFloatingRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 2), state)).toHaveLength(0);
  });
  it('allows elevation 0 (clears terrain)', () => {
    expect(mountainFloatingRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 0), makeState())).toHaveLength(0);
  });
});

describe('V-WTR-01: No Floating Water', () => {
  it('allows water at elevation 0', () => {
    expect(waterFloatingRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Water, 0), makeState())).toHaveLength(0);
  });
  it('allows water at elevation 1', () => {
    expect(waterFloatingRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Water, 1), makeState())).toHaveLength(0);
  });
  it('allows water at elevation 2 with mountain at elevation 1', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    expect(waterFloatingRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Water, 2), state)).toHaveLength(0);
  });
  it('rejects water at elevation 2 with nothing below', () => {
    expect(waterFloatingRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Water, 2), makeState())).toHaveLength(1);
  });
});
