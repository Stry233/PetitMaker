import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from './constants';
import { TerrainType, CellZone } from './types';

export function hexStringToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** A PixiJS-compatible numeric colour for a terrain type at an elevation; 0 where the type draws
 *  nothing of its own, or the elevation is past the ramp. */
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

/** A PixiJS-compatible numeric colour for a zone; 0 for a zone with no colour of its own. */
export function getZoneColor(zone: CellZone): number {
  const hex = ZONE_COLORS[zone];
  return hex ? hexStringToNumber(hex) : 0;
}
