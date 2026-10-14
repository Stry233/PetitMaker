/**
 * V-LOCK-01: Layer Lock (pre-command)
 *
 * Prevents terrain modification on locked elevation layers.
 *
 * A cell at elevation E occupies layers 1..E. If any of those layers is locked,
 * the cell cannot be overwritten or erased. Painting at a locked target elevation
 * is also rejected regardless of existing terrain. A corner trim reshapes what it stands on, so
 * it is refused when its terrain or road stands on a locked layer, and a fillet when the column
 * it raises crosses one.
 *
 * `state.lockedLayers` is written by the editor's layer-lock state; this rule only reads it.
 */
import { CommandType, type GridState, type MacroCoord, type TrimCornersCommand, type ValidationError } from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../core/game/profile';
import { roadLookup } from '../state/object-index';
import { evidenceOn } from '../core/grid/grids';
import { definePreRule } from './define';

export const layerLockRule = definePreRule({
  id: 'V-LOCK-01',
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain, CommandType.TrimCorners],
  validate(cmd, state, fail) {
    if (state.lockedLayers.size === 0) return [];
    if (cmd.type === CommandType.TrimCorners) {
      return trimTouchesLockedLayer(state, cmd)
        ? [fail('error.layer_locked', evidenceOn(cmd.layer === 'road' ? PLACEMENT_GRID : TERRAIN_GRID, [{ x: cmd.x, y: cmd.y }]))]
        : [];
    }
    const targetLocked = cmd.type === CommandType.PaintTerrain && state.lockedLayers.has(cmd.elevation);
    const errors: ValidationError[] = [];
    for (const coord of cmd.cells) {
      if (targetLocked || isOccupyingLockedLayer(state, coord)) {
        errors.push(fail('error.layer_locked', evidenceOn(TERRAIN_GRID, [coord])));
      }
    }
    return errors;
  },
});

function isOccupyingLockedLayer(state: GridState, coord: MacroCoord): boolean {
  const cell = getCell(state.cells, coord.x, coord.y);
  if (!cell?.terrain) return false;
  for (let layer = 1; layer <= cell.terrain.elevation; layer++) {
    if (state.lockedLayers.has(layer)) return true;
  }
  return false;
}

/** Whether a trim's surface stands on a locked layer: the layers 1..E under the terrain or road it
 *  reshapes, and for a fillet the column up to the tier it raises (its own tier even at layer 0). */
function trimTouchesLockedLayer(state: GridState, cmd: TrimCornersCommand): boolean {
  const standing = cmd.layer === 'road'
    ? roadLookup(state)(cmd.x, cmd.y)?.elevation ?? 0
    : getCell(state.cells, cmd.x, cmd.y)?.terrain?.elevation ?? 0;
  const target = cmd.patchOnly ? cmd.elevation : standing;
  const top = Math.max(standing, target);
  for (const layer of state.lockedLayers) {
    if (layer === target || (layer > 0 && layer <= top)) return true;
  }
  return false;
}
