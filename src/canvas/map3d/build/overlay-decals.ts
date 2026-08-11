/**
 * Surface-draped decal geometry for the 3D tool overlay: one flat polygon per
 * cell at that cell's standable height plus a small lift (no z-fighting with
 * the surface it annotates), on the grid the tool paints — terrain tools use
 * the micro grid (−0.5 world offset), object tools the macro grid. Pure and
 * three-free; Overlay3D wraps the arrays into a BufferGeometry.
 *
 * A cell the stroke's auto-trim will CUT is drawn as its four quadrants through
 * the same `cornerPolygon` the terrain mesher bevels with, so the ghost promises
 * the silhouette the click leaves rather than a square.
 */
import type { Corners, GridState, MacroCoord } from '../../../core/model/types';
import { CORNER_POS } from '../../../core/edge-cut/corner-index';
import { mapCenterOffset } from '../core/coords';
import { surfaceHeightAt } from '../interaction/pick';
import { roadShapePoints } from '../../../core/edge-cut/road-shape';
import type { RoadConnSide } from '../../../core/edge-cut/road-cut-states';
import { cornerPolygon, type Pt } from './quadrant-poly';

export const DECAL_LIFT = 0.025;

export interface DecalMesh { positions: number[]; index: number[] }

/** One cell whose shape auto-trim will change — `TrimmedCell` as the decal builder needs it,
 *  with the corners the caller already reduced to what the stroke ADDS (2D's `filletOnly`).
 *  `road` marks a paved TILE: its corners are canonical road-cut tokens, not quadrants, so it is
 *  draped as the road polygon instead (see `core/edge-cut/road-shape`). */
export interface DecalTrim { x: number; y: number; corners: Corners; patch: boolean; road?: RoadConnSide }

/** Quadrant top-left offsets within a cell, in the corner order [TL, TR, BL, BR] — the unit-cell
 *  twin of trim-shapes' pixel QUADRANT_OFFSETS. */
const QUADRANT: readonly Pt[] = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];

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
    const h = surfaceHeightAt(state, x0 + 0.5, z0 + 0.5) + DECAL_LIFT;
    push([[x0, z0], [x0 + 1, z0], [x0 + 1, z0 + 1], [x0, z0 + 1]], h);
  }
  for (const t of trim) {
    if (!drawable(t.x, t.y)) continue;
    const [x0, z0] = cellOrigin(t.x, t.y);
    // One height for the whole cell: an edge cut is silhouette-only, so every quadrant of it
    // drapes on the same standable surface.
    const h = surfaceHeightAt(state, x0 + 0.5, z0 + 0.5) + DECAL_LIFT;
    if (t.road) {
      // The road's own drawn outline, the one `buildRoadTrimMesh` meshes the committed tile with.
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
