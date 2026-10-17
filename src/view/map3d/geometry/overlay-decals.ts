/**
 * Surface-draped decal geometry for the 3D tool overlay: flat polygons following the visible terrain
 * surface plus a small lift (no z-fighting with the surface it annotates), on the grid the tool
 * paints — terrain tools use the terrain grid, object tools the placement grid. Pure
 * and three-free; OverlayLayer3D wraps the arrays into a BufferGeometry.
 *
 * A cell is a square only where nothing has trimmed it: `surface-pieces` splits a trimmed or
 * Γ-patched cell into the pieces the mesher drew there, each at its own height, so a drape lands on
 * a cut corner's revealed step instead of hanging over it. A cell of another grid lies across four
 * terrain cells, so it drapes as the pieces of each, clipped to it: a placement cell over a step
 * lies on both tiers instead of taking one tier's height.
 *
 * A cell the stroke's auto-trim will cut is a different question — there the decal promises the
 * silhouette the click will leave, drawn through the same `cornerPolygon` the mesher bevels with, at
 * the one height that result will stand at.
 */
import type { Corners, GridState, MacroCoord } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import { gridCellRect, gridCellsUnder, type GridId } from '../../../core/grid/grids';
import { GRIDS, TERRAIN_GRID } from '../../../core/game/profile';
import { CORNER_POS } from '../../../core/model/corners';
import { cellCornerWorld, mapCenterOffset } from './coords';
import { surfaceHeightAt } from './pick';
import { roadShapePoints } from '../../shared/road/shape';
import type { RoadConnSide } from '../../../core/domain/edge-cut/road-cut-states';
import { clipToBox, cornerPolygon, type Pt } from '../../shared/terrain/quadrant-poly';
import { QUADRANT, cellSurfacePieces, cellTopY, pieceYAt } from './surface-pieces';
import { cellKey } from '../../../core/grid/rect';

export const DECAL_LIFT = 0.025;

export interface DecalMesh { positions: number[]; index: number[] }

/** One decal mesh holding `a` and every one of `rest`, in order. */
export function joinDecals(a: DecalMesh, ...rest: DecalMesh[]): DecalMesh {
  let out = a;
  for (const b of rest) {
    if (b.positions.length === 0) continue;
    const base = out.positions.length / 3;
    out = { positions: [...out.positions, ...b.positions], index: [...out.index, ...b.index.map((i) => i + base)] };
  }
  return out;
}

/** One cell whose shape auto-trim will change — `TrimmedCell` as the decal builder needs it,
 *  with the corners the caller already reduced to what the stroke adds (2D's `filletOnly`).
 *  `road` marks a paved tile: its corners are canonical road-cut tokens, not quadrants, so it is
 *  draped as the road polygon instead (see `view/shared/road/shape`). */
export interface DecalTrim { x: number; y: number; corners: Corners; patch: boolean; road?: RoadConnSide }

export function cellDecals(
  state: GridState,
  cells: readonly MacroCoord[],
  grid: GridId,
  trim: readonly DecalTrim[] = [],
): DecalMesh {
  const { width, height } = state.template;
  const positions: number[] = [];
  const index: number[] = [];
  // Keep a ring past the map edge drawable (a brush hanging off the border
  // still previews, like 2D), but drop far-off sentinel cells.
  const drawable = (x: number, y: number): boolean => !(x < -2 || y < -2 || x > width + 2 || y > height + 2);
  const cellOrigin = (x: number, y: number): Pt => { const w = cellCornerWorld(x, y, width, height, grid); return [w.x, w.z]; };
  /** Fan-triangulate a convex XZ polygon at world height `h`. */
  const push = (pts: readonly Pt[], h: number): void => {
    const base = positions.length / 3;
    for (const [px, pz] of pts) positions.push(px, h, pz);
    for (let i = 1; i < pts.length - 1; i++) index.push(base, base + i, base + i + 1);
  };

  const trimmed = new Set(trim.map((t) => cellKey(t.x, t.y)));
  const onTerrain = grid === TERRAIN_GRID;
  for (const { x, y } of cells) {
    if (!onTerrain) {
      const area = gridCellRect(GRIDS[grid], { x, y });
      if (drawable(area.x, area.y) && !trimmed.has(cellKey(x, y))) drapeArea(state, area, push);
      continue;
    }
    if (!drawable(x, y) || trimmed.has(cellKey(x, y))) continue;   // a trimmed cell draws its own shape below
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
      const pts = roadShapePoints(t.corners, t.road, { x: x0, y: z0, w: 1, h: 1 });
      if (pts) push(pts, h);
      continue;
    }
    for (let i = 0; i < 4; i++) {
      const q = QUADRANT[i]!;
      // `patch` picks the inner fan winding, the one a Γ fillet is drawn with everywhere it is
      // committed (the terrain mesher's fillet pass, and 2D's own ghost outline): its arc bulges
      // into the notch it fills instead of rounding away from it.
      const poly = cornerPolygon(t.corners[i]!, { x: x0 + q[0], z: z0 + q[1], s: 0.5, pos: CORNER_POS[i]! }, t.patch);
      if (poly) push(poly, h);
    }
  }
  return { positions, index };
}

/**
 * The visible surface under `area` (map cells), lifted: each terrain cell it crosses gives its own
 * pieces clipped to the area, each at its own height, and a terrain cell off the map a flat quad at
 * the world-space surface sample.
 */
function drapeArea(state: GridState, area: Rect, push: (pts: readonly Pt[], h: number) => void): void {
  const { width, height } = state.template;
  const off = mapCenterOffset(width, height);
  const ax0 = area.x - off.x, az0 = area.y - off.z, ax1 = ax0 + area.w, az1 = az0 + area.h;
  for (const t of gridCellsUnder(GRIDS[TERRAIN_GRID], area)) {
    const corner = cellCornerWorld(t.x, t.y, width, height, TERRAIN_GRID);
    const x0 = Math.max(ax0, corner.x), z0 = Math.max(az0, corner.z);
    const x1 = Math.min(ax1, corner.x + 1), z1 = Math.min(az1, corner.z + 1);
    if (x1 <= x0 || z1 <= z0) continue;
    const pieces = cellSurfacePieces(state, t.x, t.y, corner.x, corner.z);
    if (!pieces) {
      push([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], surfaceHeightAt(state, (x0 + x1) / 2, (z0 + z1) / 2) + DECAL_LIFT);
      continue;
    }
    for (const p of pieces) {
      const poly = clipToBox(p.poly, x0, z0, x1, z1);
      if (poly.length >= 3) push(poly, p.y + DECAL_LIFT);
    }
  }
}

/**
 * Decals for bodies rather than cells: one quad per rect, split at the terrain cell boundaries it
 * crosses and clipped to the rect, each piece draped at its own terrain cell's surface height.
 *
 * A body is not a cell set — an object's footprint sits on the half grid wherever its anchor does
 * (a landmark, ramp or bridge on the half grid) — so a cell-granular decal would either overshoot the drawn
 * body or lose part of it. Splitting per terrain cell is what keeps a large body (a landmark)
 * lying on the terraces it crosses instead of floating at one height above them.
 *
 * A body stays a rect within each terrain cell rather than following the cell's trim pieces: it is
 * one flat quad there, so it takes the height of the piece its own centre stands on.
 */
export function rectDecals(
  state: GridState,
  rects: readonly { x: number; y: number; w: number; h: number }[],
  grid: GridId,
): DecalMesh {
  const { width, height } = state.template;
  const off = mapCenterOffset(width, height);
  const positions: number[] = [];
  const index: number[] = [];
  for (const r of rects) {
    if (r.w <= 0 || r.h <= 0) continue;
    const area = { ...r, x: r.x + GRIDS[grid].offset.x, y: r.y + GRIDS[grid].offset.y };
    const ax0 = area.x - off.x, az0 = area.y - off.z, ax1 = ax0 + area.w, az1 = az0 + area.h;
    for (const t of gridCellsUnder(GRIDS[TERRAIN_GRID], area)) {
      if (t.x < -2 || t.y < -2 || t.x > width + 2 || t.y > height + 2) continue;
      const corner = cellCornerWorld(t.x, t.y, width, height, TERRAIN_GRID);
      const wx0 = Math.max(ax0, corner.x), wz0 = Math.max(az0, corner.z);
      const wx1 = Math.min(ax1, corner.x + 1), wz1 = Math.min(az1, corner.z + 1);
      if (wx1 <= wx0 || wz1 <= wz0) continue;
      const mid: [number, number] = [(wx0 + wx1) / 2, (wz0 + wz1) / 2];
      const pieces = cellSurfacePieces(state, t.x, t.y, corner.x, corner.z);
      const h = (pieces ? pieceYAt(pieces, mid[0], mid[1]) : surfaceHeightAt(state, mid[0], mid[1])) + DECAL_LIFT;
      const base = positions.length / 3;
      positions.push(wx0, h, wz0, wx1, h, wz0, wx1, h, wz1, wx0, h, wz1);
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { positions, index };
}
