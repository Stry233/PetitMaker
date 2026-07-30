import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from './constants';
import { TerrainType, CellZone } from './types';

export function hexStringToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Return a PixiJS-compatible numeric color for the given terrain type and elevation.
 * - Mountain: lookup ELEVATION_COLORS by elevation level.
 * - Water: WATER_COLOR.
 * - None/other: returns 0.
 */
export function getTerrainColor(type: TerrainType, elevation: number): number {
  if (type === TerrainType.Water) {
    return hexStringToNumber(WATER_COLOR);
  }
  if (type === TerrainType.Mountain) {
    const hex = ELEVATION_COLORS[elevation];
    return hex ? hexStringToNumber(hex) : 0;
  }
  return 0;
}

/**
 * Return a PixiJS-compatible numeric color for a zone.
 * Void (0) returns 0x000000.
 */
export function getZoneColor(zone: CellZone): number {
  const hex = ZONE_COLORS[zone];
  return hex ? hexStringToNumber(hex) : 0;
}
