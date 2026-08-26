/**
 * V-LOCK-01: Layer Lock (pre-command)
 *
 * Prevents terrain modification on locked elevation layers.
 *
 * A cell at elevation E occupies layers 1..E. If ANY of those layers is locked,
 * the cell cannot be overwritten or erased. Painting at a locked target elevation
 * is also rejected regardless of existing terrain.
 *
 * `state.lockedLayers` is maintained by the UI; this rule only reads it.
 */
import {
  CommandType,
  type Command,
  type GridState,
  type MacroCoord,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { getCell } from '../core/model/grid-model';

export const layerLockRule: PreCommandRule = {
  id: 'V-LOCK-01',
  agentHint: 'Terrain on a locked layer cannot be modified (user setting; tell the user to unlock it).',
  phase: 'pre-command',
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain],
  validate(cmd: Command, state: GridState): ValidationError[] {
    if (state.lockedLayers.size === 0) return [];
    const errors: ValidationError[] = [];
    if (cmd.type === CommandType.PaintTerrain) {
      if (state.lockedLayers.has(cmd.elevation)) {
        for (const coord of cmd.cells) {
          errors.push({ ruleId: 'V-LOCK-01', message: 'error.layer_locked', cells: [coord], severity: 'error' });
        }
        return errors;
      }
      for (const coord of cmd.cells) {
        if (isOccupyingLockedLayer(state, coord)) {
          errors.push({ ruleId: 'V-LOCK-01', message: 'error.layer_locked', cells: [coord], severity: 'error' });
        }
      }
    }
    if (cmd.type === CommandType.EraseTerrain) {
      for (const coord of cmd.cells) {
        if (isOccupyingLockedLayer(state, coord)) {
          errors.push({ ruleId: 'V-LOCK-01', message: 'error.layer_locked', cells: [coord], severity: 'error' });
        }
      }
    }
    return errors;
  },
};

function isOccupyingLockedLayer(state: GridState, coord: MacroCoord): boolean {
  const cell = getCell(state.cells, coord.x, coord.y);
  if (!cell?.terrain) return false;
  for (let layer = 1; layer <= cell.terrain.elevation; layer++) {
    if (state.lockedLayers.has(layer)) return true;
  }
  return false;
}
