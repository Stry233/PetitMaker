/**
 * V-MTN-02 / V-WTR-01: No Floating Blocks (pre-command)
 *
 * Terrain at elevation N > 1 requires terrain at N-1 at the same cell.
 * Cannot skip layers. Water IS valid support for the floating check
 * (water is terrain), but water is NOT valid for the 3x3 base check (V-MTN-03).
 *
 * Elevation 0 and 1 always pass: ground implicitly supports layer 1.
 *
 * Two rule instances share the same logic via `validateNoFloating`:
 * - mountainFloatingRule (V-MTN-02): checks Mountain commands
 * - waterFloatingRule (V-WTR-01): checks Water commands
 */
import {
  CommandType,
  TerrainType,
  type Command,
  type GridState,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { surfaceElevation } from '../core/edge-cut/terrain-silhouette';

function validateNoFloating(
  cmd: Command, state: GridState, ruleId: string, targetType: TerrainType,
): ValidationError[] {
  if (cmd.type !== CommandType.PaintTerrain) return [];
  if (cmd.terrainType !== targetType) return [];
  if (cmd.elevation <= 1) return [];
  const errors: ValidationError[] = [];
  for (const coord of cmd.cells) {
    const cell = getCell(state.cells, coord.x, coord.y);
    // Support = the cell's STRUCTURAL height (a Γ fillet's real base, not its
    // cosmetic tier) — a mass-less fillet must not let a paint skip layers.
    if (!cell || surfaceElevation(cell.terrain) < cmd.elevation - 1) {
      errors.push({ ruleId, message: 'error.floating_block', cells: [coord], severity: 'error' });
    }
  }
  return errors;
}

export const mountainFloatingRule: PreCommandRule = {
  id: 'V-MTN-02',
  agentHint: 'Painting mountain at elevation N>1 requires the same cell to already hold elevation N-1 (the paint_terrain tool auto-builds tiers for you).',
  phase: 'pre-command',
  appliesTo: [CommandType.PaintTerrain],
  validate(cmd, state) { return validateNoFloating(cmd, state, 'V-MTN-02', TerrainType.Mountain); },
};

export const waterFloatingRule: PreCommandRule = {
  id: 'V-WTR-01',
  agentHint: 'Painting water at elevation N>1 requires terrain at N-1 at the same cell — elevated water sits ON mountains; build the mountain first.',
  phase: 'pre-command',
  appliesTo: [CommandType.PaintTerrain],
  validate(cmd, state) { return validateNoFloating(cmd, state, 'V-WTR-01', TerrainType.Water); },
};
