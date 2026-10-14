import { PALETTE, ZONES } from '../game/profile';

/** A mountain's colour by layer, the ground's at 0 (`PALETTE.elevation`). */
export const ELEVATION_COLORS: readonly string[] = PALETTE.elevation;

export const WATER_COLOR: string = PALETTE.water;

/** Each zone's 2D colour (`ZONES`), by zone id. */
export const ZONE_COLORS: Readonly<Record<number, string>> =
  Object.fromEntries(Object.entries(ZONES).map(([id, spec]) => [id, spec.color]));
