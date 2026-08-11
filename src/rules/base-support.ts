/**
 * V-MTN-03: 3x3 Base Support (post-stroke)
 *
 * Every mountain at elevation N >= 4 must have a full 3x3 area of solid support
 * at some LOWER elevation E where E >= N-3. A support cell is solid if its mass
 * reaches elevation >= E, OR it is covered by a `terrainBase` object (the central
 * plaza, or any future base-providing building) whose elevation >= E.
 *
 * WATER IS ONE LAYER DEEP. A water cell at elevation N is a single water block at N
 * resting on riverbed mass at N-1 (RULES.md §7: "all water blocks have a depth of 1",
 * and "a river does not float"). So it supports a base BELOW its surface, up to N-1,
 * and never at its own level — the water block itself is not a base (RULES.md §4
 * case 7, §7 regulation 2: a river at layer 1 has no mass under it and therefore
 * breaks the 3x3 base of a layer-4 neighbour, exactly as before).
 *
 * The base must be BELOW the cell — a 3x3 group at the same elevation N cannot
 * serve as its own base. The check scans centered 3x3 at each
 * elevation from N-1 down to max(1, N-3).
 *
 * Layers 1-3 are exempt: ground (elevation 0) always provides a valid base.
 */
import {
  TerrainType,
  type GridState,
  type PostStrokeRule,
  type ValidationError,
} from '../core/model/types';
import { cellOverlapsRect, type Rect } from '../core/model/grid-model';
import { objectRect } from '../state/object-geometry';
import { getCatalogItem } from '../state/catalog';
import { hasTrait } from '../core/model/traits';
import { surfaceElevation } from '../core/edge-cut/terrain-silhouette';

interface TerrainBase { rect: Rect; elevation: number; }

export const baseSupportRule: PostStrokeRule = {
  id: 'V-MTN-03',
  agentHint: 'POST-CHECK — a mountain cell at elevation >=4 needs a full 3x3 base at some elevation >= N-3 below it. Build pyramids, not 1-wide towers. Water is NOT structural.',
  phase: 'post-stroke',

  validate(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[] {
    const { width, height } = state.template;
    const errors: ValidationError[] = [];

    // Footprints that act as a structural base (the plaza, etc.), with elevation.
    const bases: TerrainBase[] = [];
    for (const [, obj] of state.objects) {
      const item = getCatalogItem(obj.catalogId);
      if (item && hasTrait(item, 'terrainBase')) {
        bases.push({ rect: objectRect(obj), elevation: obj.elevation });
      }
    }

    // Solid mass per cell, derived ONCE. Every cell is read by up to nine 3x3 tests (its own and
    // each neighbour's), so deriving it per test made this rule ~73% of the whole post-stroke sweep
    // — and the sweep runs once per commit AND once per undo inside the auto-revert loop.
    const mass = massField(state, width, height);

    for (let y = 0; y < height; y++) {
      const row = state.cells[y];
      for (let x = 0; x < width; x++) {
        const t = row?.[x]?.terrain;
        if (!t || t.type !== TerrainType.Mountain) continue;
        // The STANDABLE surface, not raw elevation: a Γ patch/fillet's real height is its patchBase
        // (a cosmetic fillet at tier N over a base block holds no structural mass at N), so a
        // cosmetic-4 fillet on a base-3 block is structurally a layer-3 mountain — exempt. For a
        // mountain that is exactly what `mass` holds, so it is read rather than derived twice.
        const elev = mass[y * width + x]!;
        if (elev < 4) continue;

        if (!has3x3Base(mass, width, height, x, y, elev, bases)) {
          errors.push({
            ruleId: 'V-MTN-03',
            message: 'error.need_3x3_base',
            cells: [{ x, y }],
            severity: 'error',
          });
          if (opts?.firstOnly) return errors;
        }
      }
    }
    return errors;
  },
};

/**
 * The layer each cell's SOLID MASS reaches, indexed y*width+x; −1 where a cell holds none.
 *
 * Mountain mass reaches its standable surface (a Γ patch counts via its patchBase —
 * surfaceElevation, not the cosmetic tier). Water mass stops one layer under the surface: the top
 * block is water, the riverbed below it is not.
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
      out[y * width + x] = !t ? -1
        : t.type === TerrainType.Mountain ? surfaceElevation(t)
        : t.type === TerrainType.Water ? surfaceElevation(t) - 1
        : -1;
    }
  }
  return out;
}

function has3x3Base(
  mass: Int8Array, width: number, height: number,
  x: number, y: number, targetElev: number, bases: TerrainBase[],
): boolean {
  // Per-cell support ("cap >= E") is monotone in E, so a valid E in [max(1, N-3), N-1] exists iff
  // the LOWEST candidate E works — one 3x3 pass at E = max(1, N-3) suffices, because lower layers
  // are implied by the no-floating rule (and no realSurface allocations in the hot loop).
  const minBase = Math.max(1, targetElev - 3);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      // Off the map is not support: the 3x3 must land entirely on the grid.
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      if (mass[ny * width + nx]! >= minBase) continue;
      if (!bases.some(b => b.elevation >= minBase && cellOverlapsRect(b.rect, nx, ny, -0.5))) return false;
    }
  }
  return true;
}
