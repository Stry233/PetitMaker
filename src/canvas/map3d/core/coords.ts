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

/** The VISIBLE standable surface of a layer: elevated terrain tops out exactly at
 *  layerToY(e), but layer 0 is covered by the ground slab — an object based at raw
 *  layer 0 sinks into it, and the buried faces depth-fight the slab plane (small
 *  models shimmer at viewing distance). */
export function surfaceY(layer: number): number {
  return layer === 0 ? GROUND_SLAB_Y : layerToY(layer);
}

/** World X/Z of the CORNER (low edge) of macro cell (cx, cy). The object and
 *  terrain builders work from cell corners + size, so a cell-centre helper isn't
 *  needed; the footprint centre is derived as corner + size/2 by the caller. */
export function cellCornerWorld(cx: number, cy: number, width: number, height: number): { x: number; z: number } {
  const off = mapCenterOffset(width, height);
  return { x: cx - off.x, z: cy - off.z };
}
