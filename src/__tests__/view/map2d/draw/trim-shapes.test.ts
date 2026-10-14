import { describe, it, expect } from 'vitest';
import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from '../../../../core/model/palette';
import { getTerrainColor, getZoneColor } from '../../../../view/map2d/draw/terrain-color';
import { QUADRANT_OFFSETS } from '../../../../view/map2d/draw/trim-shapes';
import { QUADRANT_PX } from '../../../../view/map2d/geometry/world';
import { TerrainType } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';

describe('colors', () => {
  it('returns correct elevation color for mountain at levels 1, 5, 8', () => {
    for (const level of [1, 5, 8] as const) {
      const expected = parseInt(ELEVATION_COLORS[level]!.replace('#', ''), 16);
      expect(getTerrainColor(TerrainType.Mountain, level)).toBe(expected);
    }
  });

  it('returns water color for water type', () => {
    const expected = parseInt(WATER_COLOR.replace('#', ''), 16);
    expect(getTerrainColor(TerrainType.Water, 0)).toBe(expected);
  });

  it('returns zone colors from constants', () => {
    const beachExpected = parseInt(ZONE_COLORS[1]!.replace('#', ''), 16);
    expect(getZoneColor(CellZone.Beach)).toBe(beachExpected);
    const grassExpected = parseInt(ZONE_COLORS[2]!.replace('#', ''), 16);
    expect(getZoneColor(CellZone.Grass)).toBe(grassExpected);
    expect(getZoneColor(3 as CellZone)).toBe(0);
  });

  it('returns sea color for Void zone', () => {
    const voidExpected = parseInt(ZONE_COLORS[0]!.replace('#', ''), 16);
    expect(getZoneColor(CellZone.Void)).toBe(voidExpected);
  });
});

describe('QUADRANT_OFFSETS', () => {
  it('holds the correct offsets in TL, TR, BL, BR order', () => {
    expect(QUADRANT_OFFSETS[0]).toEqual([0, 0]);                 // TL
    expect(QUADRANT_OFFSETS[1]).toEqual([QUADRANT_PX, 0]);         // TR
    expect(QUADRANT_OFFSETS[2]).toEqual([0, QUADRANT_PX]);         // BL
    expect(QUADRANT_OFFSETS[3]).toEqual([QUADRANT_PX, QUADRANT_PX]); // BR
  });
});
