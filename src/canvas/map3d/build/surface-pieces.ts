/**
 * The VISIBLE top surfaces of ONE terrain cell — the polygons the terrain mesher drew there, each at
 * the world Y it drew them at. Pure and three-free; the drape builders (`overlay-decals`) lay their
 * decals on these.
 *
 * A trimmed cell is not a square at one height. A cut corner is rounded away and what shows in its
 * place is the surface behind it (a lower step, the water it sits in, the ground), and a Γ patch's
 * fillet stands a tier above the base filling the rest of the cell. Reading the cell's top and
 * covering the whole square would leave a region highlight hanging in the air over every trim.
 *
 * The split mirrors `terrain-geometry`'s bevel path piece for piece: `cornerPolygon` for what a trim
 * keeps, `cornerComplement` for what it opens, `cutBackingByCorner` for what stands behind that, and
 * `patchCornerSplit` for the base/fillet pass of a Γ patch.
 */
import { CellZone, TerrainType, type CornerTrim, type GridState, type TerrainCell } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { solidTopOf } from '../../../core/edge-cut/terrain-silhouette';
import { patchCornerSplit } from '../../../core/edge-cut/patch-corners';
import { cutBackingByCorner, type CutBacking } from '../../../core/edge-cut/cut-backing';
import { CORNER_POS } from '../../../core/edge-cut/corner-index';
import { GROUND_SLAB_Y, SEA_Y, layerToY, waterSurfaceY } from '../core/coords';
import { cornerComplement, cornerPolygon, type Pt } from './quadrant-poly';

/** Quadrant top-left offsets within a cell, in the corner order [TL, TR, BL, BR] — the unit-cell
 *  twin of trim-shapes' pixel QUADRANT_OFFSETS. */
export const QUADRANT: readonly Pt[] = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];

/** One flat XZ polygon of a cell's visible surface, at the height it is drawn at. */
export interface SurfacePiece { poly: Pt[]; y: number }

/** The height of the ground under a cell: the sea for a void cell, the land slab otherwise. */
function groundYOf(state: GridState, x: number, y: number): number {
  return getCell(state.cells, x, y)?.zone === CellZone.Void ? SEA_Y : GROUND_SLAB_Y;
}

/** The height a cut corner opens onto: its backing surface, or the ground where nothing backs it. */
function backingY(b: CutBacking | null | undefined, ground: number): number {
  if (!b) return ground;
  return b.type === TerrainType.Water ? waterSurfaceY(b.elevation) : layerToY(b.elevation);
}

/** What one quadrant keeps, and what its cut opens onto. */
interface QuadrantPlan { kept: CornerTrim; inner: boolean; keptY: number; backY: number }

/** The kept shape + the cut-away region of each quadrant, which partition the cell between them. */
function quadrantPieces(x0: number, z0: number, plan: (i: number) => QuadrantPlan): SurfacePiece[] {
  const out: SurfacePiece[] = [];
  for (let i = 0; i < 4; i++) {
    const q = QUADRANT[i]!, pos = CORNER_POS[i]!;
    const qx = x0 + q[0], qz = z0 + q[1];
    const { kept, inner, keptY, backY: back } = plan(i);
    const keep = cornerPolygon(kept, qx, qz, 0.5, pos, inner);
    if (keep) out.push({ poly: keep, y: keptY });
    const cut = cornerComplement(kept, qx, qz, 0.5, pos, inner);
    if (cut) out.push({ poly: cut, y: back });
  }
  return out;
}

/** A Γ patch's two passes: the fillet at the cell's cosmetic tier, the real base under everything
 *  else. `tierY` is the type's own surface height (a water fillet floats its SEA_Y above its layer). */
function patchPieces(
  state: GridState, x: number, y: number, t: TerrainCell, x0: number, z0: number,
  ground: number, tierY: (tier: number) => number,
): SurfacePiece[] {
  const { baseTier, baseCorners, filletCorners } = patchCornerSplit(state, x, y, t);
  const hasBase = baseTier >= 1;
  const baseY = hasBase ? tierY(baseTier) : ground;
  const neighborAt = (dx: number, dy: number) => getCell(state.cells, x + dx, y + dy)?.terrain;
  const backs = hasBase
    ? cutBackingByCorner({ ...t, corners: baseCorners, elevation: baseTier, patchOnly: false }, baseTier, neighborAt)
    : ([null, null, null, null] as const);
  return quadrantPieces(x0, z0, (i) => (filletCorners[i] !== 'empty'
    ? { kept: filletCorners[i]!, inner: true, keptY: tierY(t.elevation), backY: baseY }
    : { kept: baseCorners[i]!, inner: false, keptY: baseY, backY: backingY(backs[i], ground) }));
}

/**
 * The visible surfaces of cell (x, y), with the cell's low corner placed at world (x0, z0) on the
 * TERRAIN (micro) grid. Null off the map, where there is no cell to read.
 */
export function cellSurfacePieces(state: GridState, x: number, y: number, x0: number, z0: number): SurfacePiece[] | null {
  const cell = getCell(state.cells, x, y);
  if (!cell) return null;
  const ground = groundYOf(state, x, y);
  const whole = (h: number): SurfacePiece[] => [{ poly: [[x0, z0], [x0 + 1, z0], [x0 + 1, z0 + 1], [x0, z0 + 1]], y: h }];
  const t = cell.terrain;
  if (!t) return whole(ground);
  const corners = t.corners;
  const trimmed = !!corners && corners.some((c) => c !== 'square');
  const neighborAt = (dx: number, dy: number) => getCell(state.cells, x + dx, y + dy)?.terrain;

  // A GROUND-ISLET cut: the macro grass floor stands, and the trimmed corner opens onto the water
  // the islet sits in.
  if (t.type === TerrainType.None) {
    if (!trimmed) return whole(ground);
    const backs = cutBackingByCorner(t, 0, neighborAt);
    return quadrantPieces(x0, z0, (i) => ({ kept: corners![i]!, inner: false, keptY: ground, backY: backingY(backs[i], ground) }));
  }

  const water = t.type === TerrainType.Water;
  const tierY = water ? waterSurfaceY : layerToY;
  const top = t.patchOnly ? t.elevation : solidTopOf(t, t.type);
  if (!water && top <= 0) return whole(ground); // no column: the mesher emits none and the ground shows
  if (t.patchOnly) return patchPieces(state, x, y, t, x0, z0, ground, tierY);
  if (!trimmed) return whole(tierY(top));
  const backs = cutBackingByCorner(t, top, neighborAt);
  return quadrantPieces(x0, z0, (i) => ({ kept: corners![i]!, inner: false, keptY: tierY(top), backY: backingY(backs[i], ground) }));
}

/**
 * The cell's OWN top surface — the height its mass is drawn at, ignoring what its trims open onto.
 * This is the height a stroke's RESULT will stand at, which is what a ghost promises; a drape over
 * committed terrain wants `cellSurfacePieces` instead. Null off the map.
 */
export function cellTopY(state: GridState, x: number, y: number): number | null {
  const cell = getCell(state.cells, x, y);
  if (!cell) return null;
  const ground = groundYOf(state, x, y);
  const t = cell.terrain;
  if (!t || t.type === TerrainType.None) return ground;
  const top = t.patchOnly ? t.elevation : solidTopOf(t, t.type);
  if (t.type === TerrainType.Water) return waterSurfaceY(top);
  return top > 0 ? layerToY(top) : ground;
}

/** The height at world (px, pz) among a cell's pieces: the piece the point falls in, else the
 *  tallest — a body drapes ON the terrain, so where a point sits outside every piece (a rounding
 *  hair off an arc) the surface it stands on is the higher one. */
export function pieceYAt(pieces: readonly SurfacePiece[], px: number, pz: number): number {
  let tallest = -Infinity;
  for (const p of pieces) {
    if (pointInPoly(p.poly, px, pz)) return p.y;
    if (p.y > tallest) tallest = p.y;
  }
  return tallest;
}

/**
 * The centre of each CELL-sized piece the span [start, start + extent) covers, in the same
 * coordinates the span is given in.
 *
 * A footprint's origin is fractional wherever its anchor is (the plaza at x.5, a ramp, a bridge), so
 * stepping in whole cells from the origin samples a set of points shifted off the cells the span
 * actually covers, and misses one of them entirely — which is a missed hill for anything that takes
 * the tallest surface under a footprint. Each centre is clamped to the span, so a partly-covered
 * cell is sampled inside the part that is covered.
 */
export function spanCellCentres(start: number, extent: number): number[] {
  const out: number[] = [];
  for (let c = Math.floor(start); c < Math.ceil(start + extent); c++) {
    out.push((Math.max(start, c) + Math.min(start + extent, c + 1)) / 2);
  }
  return out;
}

/** Ray-crossing point-in-polygon on XZ. */
function pointInPoly(poly: readonly Pt[], px: number, pz: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!, [xj, zj] = poly[j]!;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
