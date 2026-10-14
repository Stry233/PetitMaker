/**
 * V-MTN-03: 3x3 Base Support (post-stroke)
 *
 * Every mountain at elevation N >= 4 must have a full 3x3 area of solid support
 * at some lower elevation E where E >= N-3 (the thresholds are `BASE_SUPPORT`; the
 * figures here are today's values). A support cell is solid if its mass reaches
 * elevation >= E, or a `terrainBase` object standing at elevation >= E covers it.
 *
 * Water at elevation N counts as support up to N in a neighbour's window, as the mountain it
 * replaced did: the game forms waterfalls by converting a mountain block to water, and a
 * conversion that lowered the support would demolish the structure it was carving. That is all
 * it grants: nothing may be built on water, and the water's own footing is V-WTR-01's question.
 *
 * The base must be below the cell: the check scans centred 3x3 windows at each elevation from
 * N-1 down to max(1, N-3).
 *
 * Layers 1-3 are exempt: ground (elevation 0) always provides a valid base.
 */
import { TerrainType, type GridState, type ValidationError } from '../core/model/types';
import { rectsOverlap, type Rect } from '../core/grid/rect';
import { objectElevation, objectRect } from '../state/object-geometry';
import { getCatalogItem } from '../state/catalog';
import { hasTrait } from '../core/model/traits';
import { surfaceElevation } from '../core/domain/terrain/terrain-surface';
import { BASE_SUPPORT, GROUND_SUPPORT_LAYER, TERRAIN_GRID } from '../core/game/profile';
import { terrainCellRect } from '../core/grid/grid-convert';
import { evidenceOn } from '../core/grid/grids';
import { definePostRule } from './define';

interface TerrainBase { rect: Rect; elevation: number; }

const HALF_WINDOW = (BASE_SUPPORT.window - 1) / 2;

export const baseSupportRule = definePostRule({
  id: 'V-MTN-03',

  validate(state, opts, fail) {
    const { width, height } = state.template;
    const errors: ValidationError[] = [];

    // Footprints of `terrainBase` objects, with elevation.
    const bases: TerrainBase[] = [];
    for (const [, obj] of state.objects) {
      const item = getCatalogItem(obj.catalogId);
      if (item && hasTrait(item, 'terrainBase')) {
        bases.push({ rect: objectRect(obj), elevation: objectElevation(state, obj) });
      }
    }

    // Solid mass per cell, derived once: every cell is read by up to nine 3x3 tests (its own and each
    // neighbour's), and the sweep runs once per commit and once per undo inside the auto-revert loop.
    const mass = massField(state, width, height);

    const grid = { mass, width, height };
    for (let y = 0; y < height; y++) {
      const row = state.cells[y];
      for (let x = 0; x < width; x++) {
        const t = row?.[x]?.terrain;
        if (!t || t.type !== TerrainType.Mountain) continue;
        // The standable surface, not raw elevation: a Γ patch/fillet's real height is its patchBase
        // (a cosmetic fillet at tier N over a base block holds no structural mass at N), so a
        // cosmetic-4 fillet on a base-3 block is structurally a layer-3 mountain — exempt. For a
        // mountain that is exactly what `mass` holds, so it is read rather than derived twice.
        const elev = mass[y * width + x]!;
        if (elev < BASE_SUPPORT.fromLayer) continue;

        if (!has3x3Base(grid, x, y, elev, bases)) {
          errors.push(fail('error.need_base_support', evidenceOn(TERRAIN_GRID, [{ x, y }]), {
            messageParams: { window: BASE_SUPPORT.window, reach: BASE_SUPPORT.reach },
          }));
          if (opts?.firstOnly) return errors;
        }
      }
    }
    return errors;
  },
});

/**
 * The layer each cell's solid mass reaches, indexed y*width+x; −1 where a cell holds none.
 *
 * Mountain and water alike reach their standable surface (a Γ patch counts via its patchBase —
 * surfaceElevation, not the cosmetic tier): converting a block to water keeps the window's
 * support where it was.
 *
 * Int8Array: the range is −1..ELEVATION_MAX, and a typed array keeps the 3x3 test to an indexed
 * read with no per-neighbour bounds object or terrain re-derivation.
 */
function massField(state: GridState, width: number, height: number): Int8Array {
  const out = new Int8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = state.cells[y];
    for (let x = 0; x < width; x++) {
      const t = row?.[x]?.terrain;
      out[y * width + x] = !t || t.type === TerrainType.None ? -1 : surfaceElevation(t);
    }
  }
  return out;
}

function has3x3Base(
  grid: { mass: Int8Array; width: number; height: number },
  x: number, y: number, targetElev: number, bases: TerrainBase[],
): boolean {
  const { mass, width, height } = grid;
  // Per-cell support ("cap >= E") is monotone in E, so a valid E in [max(ground, N-reach), N-1]
  // exists iff the lowest candidate E works: one window pass at that E suffices, because lower
  // layers are implied by the no-floating rule (and no realSurface allocations in the hot loop).
  const minBase = Math.max(GROUND_SUPPORT_LAYER, targetElev - BASE_SUPPORT.reach);
  for (let dy = -HALF_WINDOW; dy <= HALF_WINDOW; dy++) {
    for (let dx = -HALF_WINDOW; dx <= HALF_WINDOW; dx++) {
      const nx = x + dx, ny = y + dy;
      // Off the map is not support: the 3x3 must land entirely on the grid.
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      if (mass[ny * width + nx]! >= minBase) continue;
      if (!bases.some(b => b.elevation >= minBase && rectsOverlap(b.rect, terrainCellRect({ x: nx, y: ny })))) return false;
    }
  }
  return true;
}
