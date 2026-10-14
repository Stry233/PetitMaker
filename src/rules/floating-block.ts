/**
 * No Floating Blocks (pre-command): one check, declared as V-MTN-02 for mountain paint and V-WTR-01
 * for water paint.
 *
 * Terrain above the profile's `GROUND_SUPPORT_LAYER` requires terrain at the layer beneath it in the
 * same cell, so a paint cannot skip layers. Water is valid support (water is terrain), as it is in
 * the base check (V-MTN-03). Up to that layer the ground carries the paint by itself.
 */
import { CommandType, TerrainType, type PreCommandRule, type ValidationError } from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { surfaceElevation } from '../core/domain/terrain/terrain-surface';
import { GROUND_SUPPORT_LAYER, TERRAIN_GRID } from '../core/game/profile';
import { evidenceOn } from '../core/grid/grids';
import { definePreRule } from './define';

/** The rule `id` refusing a paint of `targetType` that skips a layer. */
function floatingBlockRule<Id extends string>(id: Id, targetType: TerrainType): PreCommandRule & { readonly id: Id } {
  return definePreRule({
    id,
    appliesTo: [CommandType.PaintTerrain],
    validate(cmd, state, fail) {
      if (cmd.terrainType !== targetType) return [];
      if (cmd.elevation <= GROUND_SUPPORT_LAYER) return [];
      const errors: ValidationError[] = [];
      for (const coord of cmd.cells) {
        const cell = getCell(state.cells, coord.x, coord.y);
        // Support = the cell's structural height (a Γ fillet's real base, not its
        // cosmetic tier) — a mass-less fillet must not let a paint skip layers.
        if (!cell || surfaceElevation(cell.terrain) < cmd.elevation - 1) {
          errors.push(fail('error.floating_block', evidenceOn(TERRAIN_GRID, [coord])));
        }
      }
      return errors;
    },
  });
}

/** V-MTN-02: a mountain paint above the ground's own layer needs terrain one layer below in the same cell. */
export const mountainFloatingRule = floatingBlockRule('V-MTN-02', TerrainType.Mountain);

/** V-WTR-01: a water paint above the ground's own layer needs terrain one layer below in the same cell. */
export const waterFloatingRule = floatingBlockRule('V-WTR-01', TerrainType.Water);
