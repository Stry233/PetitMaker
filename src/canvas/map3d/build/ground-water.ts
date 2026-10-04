import { getCell } from '../../../core/model/grid-model';
import { CellZone, TerrainType, type GridState } from '../../../core/model/types';
import { GROUND_SLAB_Y, TERRAIN_OFFSET, cellCornerWorld } from '../core/coords';
import { cellSurfacePieces, pieceYAt, type SurfacePiece } from './surface-pieces';
import type { Pt } from './quadrant-poly';

/** Clip a surface to the macro-ground tile crossed by its half-cell terrain offset. */
function clipGround(poly: Pt[], x: number, z: number): Pt[] {
  for (const [axis, sign, bound] of [[0, -1, -x], [0, 1, x + 1], [1, -1, -z], [1, 1, z + 1]] as const) {
    const out: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const da = a[axis] * sign - bound, db = b[axis] * sign - bound;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    poly = out;
  }
  return poly;
}

/** One region-local surface cache shared by riverbed cuts and their bank-edge probes. */
export function groundWaterSurfaces(state: GridState) {
  const { width, height } = state.template;
  const cache = new Map<string, SurfacePiece[]>();
  const piecesAt = (x: number, y: number): SurfacePiece[] => {
    const key = `${x},${y}`;
    let pieces = cache.get(key);
    if (!pieces) {
      const corner = cellCornerWorld(x, y, width, height);
      const x0 = corner.x + TERRAIN_OFFSET, z0 = corner.z + TERRAIN_OFFSET;
      const cell = getCell(state.cells, x, y);
      pieces = (cell && cell.zone !== CellZone.Void ? cellSurfacePieces(state, x, y, x0, z0) : null) ?? [{
        poly: [[x0, z0], [x0 + 1, z0], [x0 + 1, z0 + 1], [x0, z0 + 1]], y: GROUND_SLAB_Y,
      }];
      cache.set(key, pieces);
    }
    return pieces;
  };
  const submergedAt = (x: number, z: number): boolean => {
    const tx = Math.floor(x + width / 2 - TERRAIN_OFFSET), ty = Math.floor(z + height / 2 - TERRAIN_OFFSET);
    return pieceYAt(piecesAt(tx, ty), x, z) < GROUND_SLAB_Y;
  };
  return {
    submergedAt,
    /** Null keeps the ordinary full-slab fast path away from ground-level water. */
    pieces(x: number, y: number): SurfacePiece[] | null {
      const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] as const;
      if (!cells.some(([cx, cy]) => {
        const t = getCell(state.cells, cx, cy)?.terrain;
        return t && ((t.type === TerrainType.Water && t.elevation === 0) || !!t.corners);
      })) return null;
      const corner = cellCornerWorld(x, y, width, height);
      const pieces = cells.flatMap(([cx, cy]) => piecesAt(cx, cy));
      if (!pieces.some(p => p.y < GROUND_SLAB_Y)) return null;
      return pieces.map(p => ({ poly: clipGround(p.poly, corner.x, corner.z), y: p.y }))
        .filter(p => p.poly.length >= 3);
    },
  };
}
