/**
 * Grid ↔ 3D world mapping for the preview. World units are CELL units: one
 * macro cell = 1 unit on the ground plane (X=column, Z=row), Y=up, one elevation
 * layer = LAYER_HEIGHT units. The map is centred on the origin so the orbit
 * camera frames it symmetrically.
 *
 * DUAL-GRID OFFSET (mirrors 2D): the editor places ZONES (BaseLayer) and OBJECTS
 * on the MACRO grid — cell (x,y) → world [x, x+1]. TERRAIN (mountains/water),
 * however, lives on the MICRO grid and the 2D renderer draws it shifted by
 * −HALF_TILE (half a macro cell): cell (x,y) → [x−0.5, x+0.5]. That shift is part
 * of the data model (not a 2D-only artifact) — it's why terrain stays inset from
 * the boundary and why placement rules extend their checks by 1 cell right/bottom.
 * We reproduce it via TERRAIN_OFFSET so 3D terrain sits exactly where 2D does.
 */

/** Height of one elevation layer, in cell units. < 1 so stacked steps read as a
 *  pleasant diorama rather than skyscrapers. Tunable. */
export const LAYER_HEIGHT = 0.55;

/** Half-a-macro-cell shift applied to TERRAIN blocks only (mountains + water),
 *  mirroring the 2D renderer's −HALF_TILE micro-grid offset. Zones + objects stay
 *  on the macro grid (offset 0). */
export const TERRAIN_OFFSET = -0.5;

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

/** How far a water surface floats above the layer it fills — the sea's own waterline over the void. */
export const SEA_Y = 0.05;

/** The world Y of a water surface at `tier`. A ground-level pool lies ON the land slab rather than
 *  inside it, so the surface is floored just above the slab; everything that has to meet water at
 *  its own height — the mesher, the pointer's heightfield, a surface drape — reads it here. */
export function waterSurfaceY(tier: number): number {
  return Math.max(layerToY(tier) + SEA_Y, GROUND_SLAB_Y + 0.02);
}

/** The VISIBLE standable surface of a layer: elevated terrain tops out exactly at
 *  layerToY(e), but layer 0 is covered by the ground slab — an object based at raw
 *  layer 0 sinks into it, and the buried faces depth-fight the slab plane (small
 *  models shimmer at viewing distance). */
export function surfaceY(layer: number): number {
  return layer === 0 ? GROUND_SLAB_Y : layerToY(layer);
}

/** The platform archetype's unit thickness: a ground-level plinth's deck height. */
export const PLATFORM_UNIT_H = 0.12;

/** Deck top of a platform (the plaza plinth) at `elevation`. The deck stands proud of
 *  the standable surface by the same lip the unit slab has over the ground slab, so a
 *  raised plaza clears the terrain beside it exactly as a ground one clears the grass. */
export function platformTopY(elevation: number): number {
  return surfaceY(elevation) + (PLATFORM_UNIT_H - GROUND_SLAB_Y);
}

/** World X/Z of the CORNER (low edge) of macro cell (cx, cy). The object and
 *  terrain builders work from cell corners + size, so a cell-centre helper isn't
 *  needed; the footprint centre is derived as corner + size/2 by the caller. */
export function cellCornerWorld(cx: number, cy: number, width: number, height: number): { x: number; z: number } {
  const off = mapCenterOffset(width, height);
  return { x: cx - off.x, z: cy - off.z };
}
