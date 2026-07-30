import { describe, it, expect } from 'vitest';
import { elevationRangeRule } from '../../rules/elevation-range';
import { CommandType, TerrainType } from '../../core/model/types';
import { makeState, paintCmd } from './_helpers';
import { ELEVATION_MAX } from '../../core/model/constants';

describe('V-MTN-01: Elevation Range', () => {
  it('only applies to PaintTerrain', () => {
    expect(elevationRangeRule.appliesTo).toEqual([CommandType.PaintTerrain]);
  });
  it('allows elevation 0 (clears terrain)', () => {
    expect(elevationRangeRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 0), makeState())).toHaveLength(0);
  });
  it(`allows elevation 1 through ${ELEVATION_MAX}`, () => {
    const state = makeState();
    for (let e = 1; e <= ELEVATION_MAX; e++) {
      expect(elevationRangeRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, e), state)).toHaveLength(0);
    }
  });
  it(`rejects elevation ${ELEVATION_MAX + 1}`, () => {
    expect(elevationRangeRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, ELEVATION_MAX + 1), makeState())).toHaveLength(1);
  });
  it('rejects negative elevation', () => {
    expect(elevationRangeRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, -1), makeState())).toHaveLength(1);
  });
  it('does not validate water commands', () => {
    expect(elevationRangeRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Water, 1), makeState())).toHaveLength(0);
  });
});
