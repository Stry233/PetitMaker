import { getCell } from '../../../core/model/grid-model';
import { TerrainType, type GridState } from '../../../core/model/types';
import { GROUND_SLAB_Y, cellCornerWorld, zoneSurface } from './coords';
import { cellSurfacePieces, pieceYAt, type SurfacePiece } from './surface-pieces';
import { clipToBox } from '../../shared/terrain/quadrant-poly';
import { terrainCellAt } from '../../../core/grid/grid-convert';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import { cellKey } from '../../../core/grid/rect';

/** One region-local surface cache shared by riverbed cuts and their bank-edge probes. */
export function groundWaterSurfaces(state: GridState) {
  const { width, height } = state.template;
  const cache = new Map<string, SurfacePiece[]>();
  const piecesAt = (x: number, y: number): SurfacePiece[] => {
    const key = cellKey(x, y);
    let pieces = cache.get(key);
    if (!pieces) {
      const { x: x0, z: z0 } = cellCornerWorld(x, y, width, height, TERRAIN_GRID);
      const cell = getCell(state.cells, x, y);
      pieces = (cell && zoneSurface(cell.zone) === 'land' ? cellSurfacePieces(state, x, y, x0, z0) : null) ?? [{
        poly: [[x0, z0], [x0 + 1, z0], [x0 + 1, z0 + 1], [x0, z0 + 1]], y: GROUND_SLAB_Y,
      }];
      cache.set(key, pieces);
    }
    return pieces;
  };
  const submergedAt = (x: number, z: number): boolean => {
    const { x: tx, y: ty } = terrainCellAt(x + width / 2, z + height / 2);
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
      const corner = cellCornerWorld(x, y, width, height, PLACEMENT_GRID);
      const pieces = cells.flatMap(([cx, cy]) => piecesAt(cx, cy));
      if (!pieces.some(p => p.y < GROUND_SLAB_Y)) return null;
      return pieces.map(p => ({ poly: clipToBox(p.poly, corner.x, corner.z, corner.x + 1, corner.z + 1), y: p.y }))
        .filter(p => p.poly.length >= 3);
    },
  };
}
