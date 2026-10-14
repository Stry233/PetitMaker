/** Where a 1x1 flat object may stand on a map's terrain, read back from the cells. */
import { flatIndex } from '../../core/grid/rect';
import { realSurface } from '../../core/domain/terrain/terrain-surface';
import { TerrainType, type GridState } from '../../core/model/types';

/**
 * Where a 1x1 `flat` object may stand on the finished terrain, and at what elevation.
 *
 * A plant validates its own cell plus one column right and one row bottom (the dual-grid margin), so
 * a cell one step north or west of a terrace step or a pool cannot carry one however level it is
 * itself. -1 says the cell is unplantable; anything else is the elevation the whole sweep stands at,
 * which is what cuts the map into the runs a place is composed on, and what insets a bed between two
 * water bars from the water on the sides that margin reaches.
 */
export function plantableSurface(state: GridState): Int8Array {
  const W = state.template.width, H = state.template.height;
  const out = new Int8Array(W * H).fill(-1);
  const level = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    const surf = realSurface(state.cells[y]?.[x]?.terrain);
    if (!surf) return 0;
    return surf.type === TerrainType.Water ? -1 : surf.elevation;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const e = level(x, y);
      if (e >= 0 && level(x + 1, y) === e && level(x, y + 1) === e && level(x + 1, y + 1) === e) {
        out[flatIndex(x, y, W)] = e;
      }
    }
  }
  return out;
}

/**
 * Where a road tile may be laid on the finished terrain: the cells whose whole `flat` sweep stands
 * on dry ground at one level, whatever that level is.
 *
 * A road coating asks exactly what a plant asks, so the two read one answer. It is not asking for
 * elevation 0: the streets ride the terraces they were planned on, which is what puts the town on
 * the composition instead of on a plain.
 */
export function pavableMask(state: GridState): Uint8Array {
  const surface = plantableSurface(state);
  const out = new Uint8Array(surface.length);
  for (let i = 0; i < surface.length; i++) if (surface[i]! >= 0) out[i] = 1;
  return out;
}
