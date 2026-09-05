import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from './constants';
import { TerrainType, CellZone } from './types';

export function hexStringToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// The tables are fixed, and these run per cell on every terrain redraw: parse once at module load.
const toNumbers = (table: Record<number, string>): Record<number, number> =>
  Object.fromEntries(Object.entries(table).map(([k, hex]) => [k, hexStringToNumber(hex)]));
const WATER_NUM = hexStringToNumber(WATER_COLOR);
const ELEVATION_NUMS = toNumbers(ELEVATION_COLORS);
const ZONE_NUMS = toNumbers(ZONE_COLORS);

/** A PixiJS-compatible numeric colour for a terrain type at an elevation; 0 where the type draws
 *  nothing of its own, or the elevation is past the ramp. */
export function getTerrainColor(type: TerrainType, elevation: number): number {
  if (type === TerrainType.Water) return WATER_NUM;
  if (type === TerrainType.Mountain) return ELEVATION_NUMS[elevation] ?? 0;
  return 0;
}

/** A PixiJS-compatible numeric colour for a zone; 0 for a zone with no colour of its own. */
export function getZoneColor(zone: CellZone): number {
  return ZONE_NUMS[zone] ?? 0;
}
