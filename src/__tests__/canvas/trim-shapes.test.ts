import { describe, it, expect } from 'vitest';
import { getTerrainColor, getZoneColor } from '../../core/model/colors';
import { QUADRANT_OFFSETS } from '../../canvas/map2d/draw/trim-shapes';
import { HALF_TILE } from '../../core/model/grid-model';
import { TerrainType, CellZone } from '../../core/model/types';
import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from '../../core/model/constants';

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
    const plazaExpected = parseInt(ZONE_COLORS[3]!.replace('#', ''), 16);
    expect(getZoneColor(CellZone.Plaza)).toBe(plazaExpected);
  });

  it('returns sea color for Void zone', () => {
    const voidExpected = parseInt(ZONE_COLORS[0]!.replace('#', ''), 16);
    expect(getZoneColor(CellZone.Void)).toBe(voidExpected);
  });
});

describe('QUADRANT_OFFSETS', () => {
  it('holds the correct offsets in TL, TR, BL, BR order', () => {
    expect(QUADRANT_OFFSETS[0]).toEqual([0, 0]);                 // TL
    expect(QUADRANT_OFFSETS[1]).toEqual([HALF_TILE, 0]);         // TR
    expect(QUADRANT_OFFSETS[2]).toEqual([0, HALF_TILE]);         // BL
    expect(QUADRANT_OFFSETS[3]).toEqual([HALF_TILE, HALF_TILE]); // BR
  });
});
