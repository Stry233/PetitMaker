/**
 * Colour mapping for the 3D preview. Every colour is sourced from an EXISTING
 * constant — terrain from ELEVATION_COLORS, water from WATER_COLOR, zones from
 * ZONE_COLORS, objects from their own colour else the per-category tint already
 * defined in anim-config (the same hues as the deletion poofs). No new palette.
 */
import { ELEVATION_COLORS, WATER_COLOR, ZONE_COLORS } from '../../../core/model/constants';
import { animConfig } from '../../../core/runtime/anim-config';
import type { ItemCategory, CellZone } from '../../../core/model/types';

export type Rgb = [number, number, number];

/** '#rrggbb' → [r,g,b] in 0..1. */
export function hexToRgb01(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** 0xrrggbb → [r,g,b] in 0..1. */
function intToRgb01(n: number): Rgb {
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
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
 *  else the catalog category tint, else the global fallback. Mirrors how
 *  anim-config's categoryColor is used for poofs. */
export function objectColor(
  obj: { color?: string },
  item: { category: ItemCategory; color?: string } | undefined,
): Rgb {
  if (obj.color) return hexToRgb01(obj.color);
  if (item?.color) return hexToRgb01(item.color);
  if (item) {
    const tint = animConfig.categoryColor[item.category];
    if (tint !== undefined) return intToRgb01(tint);
  }
  return intToRgb01(animConfig.fallbackColor);
}
