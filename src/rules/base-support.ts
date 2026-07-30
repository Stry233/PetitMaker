/**
 * V-MTN-03: 3x3 Base Support (post-stroke)
 *
 * Every mountain at elevation N >= 4 must have a full 3x3 area of solid support
 * at some LOWER elevation E where E >= N-3. A support cell is solid if it has
 * non-water mountain/ground terrain at elevation >= E, OR it is covered by a
 * `terrainBase` object (the central plaza, or any future base-providing building)
 * whose elevation >= E. Water is NOT structural support.
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
import { getCell, cellOverlapsRect, type Rect } from '../core/model/grid-model';
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

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = getCell(state.cells, x, y);
        if (!cell?.terrain || cell.terrain.type !== TerrainType.Mountain) continue;
        // Read the STANDABLE surface, not raw elevation: a Γ patch/fillet's real height is its
        // patchBase (a cosmetic fillet at tier N over a base block holds no structural mass at N).
        // So a cosmetic-4 fillet on a base-3 block is structurally a layer-3 mountain — exempt.
        const elev = surfaceElevation(cell.terrain);
        if (elev < 4) continue;

        if (!has3x3Base(state, x, y, elev, bases)) {
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

function has3x3Base(state: GridState, x: number, y: number, targetElev: number, bases: TerrainBase[]): boolean {
  // Per-cell support ("cap >= E") is monotone in E, so a valid E in [max(1, N-3), N-1] exists iff
  // the LOWEST candidate E works — one 3x3 pass at E = max(1, N-3) suffices, because lower layers
  // are implied by the no-floating rule (and no realSurface allocations in the hot loop).
  const minBase = Math.max(1, targetElev - 3);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      const cell = getCell(state.cells, nx, ny);
      if (!cell) return false;

      // A cell provides solid support iff its STANDABLE surface is non-water mountain reaching
      // >= minBase. A Γ patch counts via its patchBase (surfaceElevation), not its cosmetic tier.
      const t = cell.terrain;
      const terrainOk = !!t && t.type === TerrainType.Mountain && surfaceElevation(t) >= minBase;
      if (terrainOk) continue;
      if (!bases.some(b => b.elevation >= minBase && cellOverlapsRect(b.rect, nx, ny, -0.5))) return false;
    }
  }
  return true;
}
