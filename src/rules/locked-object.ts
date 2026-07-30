/**
 * V-LOCK-02: Locked Object Immutability (pre-command)
 *
 * Rejects removing an immutable (locked) object — today the central plaza
 * (createPlazaObject sets locked:true). The `locked` flag already gates
 * selection, layers, serialization and rendering; this rule extends that
 * immutability to the RemoveObject command path so no code (e.g. a bulk
 * clear, or a future tool) can dissolve the plaza's no-build footprint.
 *
 * The plaza's no-build protection itself is enforced by V-PLACE-OVERLAP
 * (objects) and V-PLACE-BLOCK (terrain) against its footprint — but only
 * while the plaza object is present in state, which is exactly what this
 * rule guarantees.
 */
import {
  CommandType,
  type Command,
  type GridState,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { getFootprint } from '../core/model/grid-model';
import { getPlacedObjectSize } from '../state/object-geometry';

export const lockedObjectRule: PreCommandRule = {
  id: 'V-LOCK-02',
  agentHint: 'Locked features (the plaza, any locked object) are PERMANENT: they cannot be moved, removed, or built over, and retrying an edit there always fails. On a lock rejection, immediately design around that footprint instead.',
  phase: 'pre-command',
  appliesTo: [CommandType.RemoveObject],
  validate(cmd: Command, state: GridState): ValidationError[] {
    if (cmd.type !== CommandType.RemoveObject) return [];
    const obj = state.objects.get(cmd.objectId);
    if (obj?.locked) {
      // Evidence = the locked object's whole footprint (what the user tried to remove).
      const { w, h } = getPlacedObjectSize(obj);
      return [{
        ruleId: 'V-LOCK-02',
        message: 'error.locked_immutable',
        cells: getFootprint(obj.position.x, obj.position.y, w, h),
        grid: 'macro',
        severity: 'error',
      }];
    }
    return [];
  },
};
