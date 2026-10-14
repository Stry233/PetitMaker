/**
 * Colour mapping for the 3D preview. Every colour is sourced from an existing
 * constant — terrain from ELEVATION_COLORS, water from WATER_COLOR, zones from
 * ZONE_COLORS, objects from their own colour else their category's tint (the same
 * hues as the deletion poofs). No new palette.
 */
import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from '../../../core/model/palette';
import type { CategoryId } from '../../../core/model/types';
import type { CellZone } from '../../../core/game/zones';
import { itemTint } from '../../shared/icon/item-tint';
import { numberToRgb01, hexStringToNumber } from '../../../core/base/color';

export type Rgb = [number, number, number];

/** '#rrggbb' → [r,g,b] in 0..1. */
export function hexToRgb01(hex: string): Rgb {
  return numberToRgb01(hexStringToNumber(hex));
}

/** Land-mass tint for a given surface elevation (0..8). */
export function terrainColor(elevation: number): Rgb {
  const hex = ELEVATION_COLORS[elevation] ?? ELEVATION_COLORS[0]!;
  return hexToRgb01(hex);
}

/** Ground-slab tint for a zone; the ground's own colour for a value that names none. */
export function zoneColor(zone: CellZone): Rgb {
  const hex = ZONE_COLORS[zone] ?? ELEVATION_COLORS[0]!;
  return hexToRgb01(hex);
}

export function waterColor(): Rgb {
  return hexToRgb01(WATER_COLOR);
}

/** An object's tint: its own colour, else its item's tint (`itemTint`), as the poofs pick theirs. */
export function objectColor(
  obj: { color?: string },
  item: { category: CategoryId; color?: string } | undefined,
): Rgb {
  return obj.color ? hexToRgb01(obj.color) : numberToRgb01(itemTint(item));
}
