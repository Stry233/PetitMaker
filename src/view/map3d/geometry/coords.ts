/**
 * Grid ↔ 3D world mapping for the preview. World units are cell units: one
 * macro cell = 1 unit on the ground plane (X=column, Z=row), Y=up, one elevation
 * layer = LAYER_HEIGHT units. The map is centred on the origin so the orbit
 * camera frames it symmetrically.
 *
 * Dual-grid offset (mirrors 2D): the editor places zones (BaseLayer) and objects
 * on the macro grid — cell (x,y) → world [x, x+1]. Terrain (mountains/water),
 * however, lives on the terrain grid, shifted by `TERRAIN_GRID_OFFSET` (half a
 * macro cell): cell (x,y) → [x−0.5, x+0.5]. That shift is part
 * of the data model (not a 2D-only artifact) — it's why terrain stays inset from
 * the boundary and why placement rules extend their checks by 1 cell right/bottom.
 * `cellCornerWorld` takes the cell's grid, so 3D terrain sits exactly where 2D does.
 */

import { zoneSpec, type CellZone } from '../../../core/game/zones';
import { gridOffset } from '../../../core/grid/grid-convert';
import type { GridId } from '../../../core/grid/grids';

/** Shared visual height of one terrain level, in ground-plane cell units. */
export const LAYER_HEIGHT = 0.9;

/** The grid-space point that maps to the world origin: half the map size. */
export function mapCenterOffset(width: number, height: number): { x: number; z: number } {
  return { x: width / 2, z: height / 2 };
}

/** World Y of the top of `layer` elevation units. */
export function layerToY(layer: number): number {
  return layer * LAYER_HEIGHT;
}

/** Top of the land slab that renders under every ground cell (cell units). */
export const GROUND_SLAB_Y = 0.08;

/** Road coating separation above the visible supporting surface, in cell units. */
export const ROAD_DECAL_LIFT = 0.02;

/** Span landings clear terrain and its road coating by a distinct depth interval. */
export const SPAN_DECK_CLEARANCE = ROAD_DECAL_LIFT + 0.01;

/** Water sits a quarter of a ground-plane cell below its same-tier bank. */
const WATER_RECESS = 0.25;

/** The ocean meets ground-level rivers at the same waterline. */
export const SEA_Y = GROUND_SLAB_Y - WATER_RECESS;

/** What the 3D view draws for a cell's own zone (`ZoneSpec.surface`): the recessed sea or the land
 *  slab. A value that names no zone draws land. */
export type ZoneSurface = 'sea' | 'land';

export function zoneSurface(zone: CellZone): ZoneSurface {
  return zoneSpec(zone)?.surface ?? 'land';
}

/** The height of the ground a cell of `zone` shows. */
export function groundYForZone(zone: CellZone): number {
  return zoneSurface(zone) === 'sea' ? SEA_Y : GROUND_SLAB_Y;
}

/** Outer sea chunks fade over at most this many cells, entirely inside the reference grid. */
export const SEA_FADE_CELLS = 16;

/** Shared waterline for terrain, picking and surface draping, in cell units. */
export function waterSurfaceY(tier: number): number {
  return surfaceY(tier) - WATER_RECESS;
}

/** Bridge landings stand on their banks, above the recessed water. */
export function bridgeDeckY(tier: number): number {
  return surfaceY(tier) + SPAN_DECK_CLEARANCE;
}

/** The visible standable surface of a layer: elevated terrain tops out exactly at
 *  layerToY(e), but layer 0 is covered by the ground slab — an object based at raw
 *  layer 0 sinks into it, and the buried faces depth-fight the slab plane (small
 *  models shimmer at viewing distance). */
export function surfaceY(layer: number): number {
  return layer === 0 ? GROUND_SLAB_Y : layerToY(layer);
}

/** The platform archetype's thickness. A platform (a landmark's floor) has none of its own: it lies
 *  flat on the surface it stands on, lifted only by the separation a road coating keeps, so it never
 *  fights the terrain top for depth. */
export const PLATFORM_UNIT_H = ROAD_DECAL_LIFT;

/** Deck top of a platform at `elevation`: the standable surface there, plus the platform's lift. */
export function platformTopY(elevation: number): number {
  return surfaceY(elevation) + PLATFORM_UNIT_H;
}

/** World X/Z of the corner (low edge) of cell (cx, cy) on `grid`; a fractional coordinate names a
 *  point. The object and terrain builders work from cell corners + size, so the footprint centre is
 *  derived as corner + size/2 by the caller. */
export function cellCornerWorld(cx: number, cy: number, width: number, height: number, grid: GridId): { x: number; z: number } {
  const off = mapCenterOffset(width, height), shift = gridOffset(grid);
  return { x: cx - off.x + shift.x, z: cy - off.z + shift.y };
}
