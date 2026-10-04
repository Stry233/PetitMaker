/**
 * Colour mapping for the 3D preview. Every colour is sourced from an EXISTING
 * constant — terrain from ELEVATION_COLORS, water from WATER_COLOR, zones from
 * ZONE_COLORS, objects from their own colour else their category's tint (the same
 * hues as the deletion poofs). No new palette.
 */
import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from '../../../core/model/constants';
import { animConfig } from '../../../core/runtime/anim-config';
import type { ItemCategory, CellZone } from '../../../core/model/types';
import { CATEGORY_BY_ID } from '../../../config/catalog/categories';
import { numberToRgb01, hexStringToNumber } from '../../../core/model/colors';

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

/** Ground-slab tint for a zone. */
export function zoneColor(zone: CellZone): Rgb {
  const hex = ZONE_COLORS[zone] ?? ZONE_COLORS[2]!;
  return hexToRgb01(hex);
}

export function waterColor(): Rgb {
  return hexToRgb01(WATER_COLOR);
}

/** An object's tint: its own colour (roads carry one, the plaza carries one)
 *  else the catalog category tint, else the global fallback, as the poofs pick theirs. */
export function objectColor(
  obj: { color?: string },
  item: { category: ItemCategory; color?: string } | undefined,
): Rgb {
  if (obj.color) return hexToRgb01(obj.color);
  if (item?.color) return hexToRgb01(item.color);
  if (item) {
    const tint = CATEGORY_BY_ID.get(item.category)?.tint;
    if (tint !== undefined) return numberToRgb01(tint);
  }
  return numberToRgb01(animConfig.fallbackColor);
}
