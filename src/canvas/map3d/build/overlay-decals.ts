/**
 * Surface-draped decal geometry for the 3D tool overlay: flat polygons following the VISIBLE terrain
 * surface plus a small lift (no z-fighting with the surface it annotates), on the grid the tool
 * paints — terrain tools use the micro grid (−0.5 world offset), object tools the macro grid. Pure
 * and three-free; Overlay3D wraps the arrays into a BufferGeometry.
 *
 * A cell is a square only where nothing has trimmed it: `build/surface-pieces` splits a trimmed or
 * Γ-patched cell into the pieces the mesher drew there, each at its own height, so a drape lands on
 * a cut corner's revealed step instead of hanging over it.
 *
 * A cell the stroke's auto-trim will CUT is a different question — there the decal promises the
 * silhouette the click will leave, drawn through the same `cornerPolygon` the mesher bevels with, at
 * the one height that result will stand at.
 */
import type { Corners, GridState, MacroCoord } from '../../../core/model/types';
import { CORNER_POS } from '../../../core/edge-cut/corner-index';
import { mapCenterOffset } from '../core/coords';
import { surfaceHeightAt } from '../interaction/pick';
import { roadShapePoints } from '../../../core/edge-cut/road-shape';
import type { RoadConnSide } from '../../../core/edge-cut/road-cut-states';
import { cornerPolygon, type Pt } from './quadrant-poly';
import { QUADRANT, cellSurfacePieces, cellTopY, pieceYAt } from './surface-pieces';

export const DECAL_LIFT = 0.025;

export interface DecalMesh { positions: number[]; index: number[] }

/** One cell whose shape auto-trim will change — `TrimmedCell` as the decal builder needs it,
 *  with the corners the caller already reduced to what the stroke ADDS (2D's `filletOnly`).
 *  `road` marks a paved TILE: its corners are canonical road-cut tokens, not quadrants, so it is
 *  draped as the road polygon instead (see `core/edge-cut/road-shape`). */
export interface DecalTrim { x: number; y: number; corners: Corners; patch: boolean; road?: RoadConnSide }

export function cellDecals(
  state: GridState,
  cells: readonly MacroCoord[],
  terrainGrid: boolean,
  trim: readonly DecalTrim[] = [],
): DecalMesh {
  const { width, height } = state.template;
  const off = mapCenterOffset(width, height);
  const shift = terrainGrid ? -0.5 : 0;
  const positions: number[] = [];
  const index: number[] = [];
  // Keep a ring past the map edge drawable (a brush hanging off the border
  // still previews, like 2D), but drop far-off sentinel cells.
  const drawable = (x: number, y: number): boolean => !(x < -2 || y < -2 || x > width + 2 || y > height + 2);
  const cellOrigin = (x: number, y: number): Pt => [x - off.x + shift, y - off.z + shift];
  /** Fan-triangulate a convex XZ polygon at world height `h`. */
  const push = (pts: readonly Pt[], h: number): void => {
    const base = positions.length / 3;
    for (const [px, pz] of pts) positions.push(px, h, pz);
    for (let i = 1; i < pts.length - 1; i++) index.push(base, base + i, base + i + 1);
  };

  const trimmed = new Set(trim.map((t) => `${t.x},${t.y}`));
  for (const { x, y } of cells) {
    if (!drawable(x, y) || trimmed.has(`${x},${y}`)) continue;   // a trimmed cell draws its own shape below
    const [x0, z0] = cellOrigin(x, y);
    // Off the map there is no cell to read, so the world-space sample answers for the ring of cells
    // a brush is allowed to hang over the border.
    const pieces = cellSurfacePieces(state, x, y, x0, z0);
    if (!pieces) {
      push([[x0, z0], [x0 + 1, z0], [x0 + 1, z0 + 1], [x0, z0 + 1]], surfaceHeightAt(state, x0 + 0.5, z0 + 0.5) + DECAL_LIFT);
      continue;
    }
    for (const p of pieces) push(p.poly, p.y + DECAL_LIFT);
  }
  for (const t of trim) {
    if (!drawable(t.x, t.y)) continue;
    const [x0, z0] = cellOrigin(t.x, t.y);
    // One height for the whole cell: the ghost promises the shape the click will leave, and that
    // shape's own mass stands at one tier.
    const h = (cellTopY(state, t.x, t.y) ?? surfaceHeightAt(state, x0 + 0.5, z0 + 0.5)) + DECAL_LIFT;
    if (t.road) {
      // The road's own drawn outline, the one `buildRoadTrimMeshes` meshes the committed tile with.
      const pts = roadShapePoints(t.corners, t.road, x0, z0, 1, 1);
      if (pts) push(pts, h);
      continue;
    }
    for (let i = 0; i < 4; i++) {
      const q = QUADRANT[i]!;
      // `patch` picks the INNER fan winding, the one a Γ fillet is drawn with everywhere it is
      // committed (the terrain mesher's fillet pass, and 2D's own ghost outline): its arc bulges
      // into the notch it fills instead of rounding away from it.
      const poly = cornerPolygon(t.corners[i]!, x0 + q[0], z0 + q[1], 0.5, CORNER_POS[i]!, t.patch);
      if (poly) push(poly, h);
    }
  }
  return { positions, index };
}

/**
 * Decals for BODIES rather than cells: one quad per rect, split at the cell boundaries it crosses
 * and clipped to the rect, each piece draped at its own cell's surface height.
 *
 * A body is not a cell set — an object's footprint sits on the half grid wherever its anchor does
 * (the plaza at x.5, a ramp/bridge) — so a cell-granular decal would either overshoot the drawn
 * body or lose part of it. Splitting per cell is what keeps a large body (the plaza is 20×27)
 * lying ON the terraces it crosses instead of floating at one height above them.
 *
 * A body stays a RECT within its cell rather than following the cell's trim pieces: it is one flat
 * quad, so it takes the height of the piece its own centre stands on.
 */
export function rectDecals(
  state: GridState,
  rects: readonly { x: number; y: number; w: number; h: number }[],
  terrainGrid: boolean,
): DecalMesh {
  const { width, height } = state.template;
  const off = mapCenterOffset(width, height);
  const shift = terrainGrid ? -0.5 : 0;
  const positions: number[] = [];
  const index: number[] = [];
  for (const r of rects) {
    if (r.w <= 0 || r.h <= 0) continue;
    for (let cy = Math.floor(r.y); cy < Math.ceil(r.y + r.h); cy++) {
      const z0 = Math.max(r.y, cy), z1 = Math.min(r.y + r.h, cy + 1);
      for (let cx = Math.floor(r.x); cx < Math.ceil(r.x + r.w); cx++) {
        const x0 = Math.max(r.x, cx), x1 = Math.min(r.x + r.w, cx + 1);
        if (x1 <= x0 || z1 <= z0) continue;
        if (cx < -2 || cy < -2 || cx > width + 2 || cy > height + 2) continue;
        const wx0 = x0 - off.x + shift, wz0 = z0 - off.z + shift;
        const wx1 = x1 - off.x + shift, wz1 = z1 - off.z + shift;
        const mid: [number, number] = [(wx0 + wx1) / 2, (wz0 + wz1) / 2];
        const pieces = cellSurfacePieces(state, cx, cy, cx - off.x + shift, cy - off.z + shift);
        const h = (pieces ? pieceYAt(pieces, mid[0], mid[1]) : surfaceHeightAt(state, mid[0], mid[1])) + DECAL_LIFT;
        const base = positions.length / 3;
        positions.push(wx0, h, wz0, wx1, h, wz0, wx1, h, wz1, wx0, h, wz1);
        index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  return { positions, index };
}
