/**
 * V-LOCK-02: Locked Object Immutability (pre-command)
 *
 * Rejects removing a locked object, such as a template landmark
 * (templateLandmarkObjects sets locked:true), on the RemoveObject command path, so
 * no caller (a bulk clear, any tool) can dissolve a locked footprint.
 *
 * V-PLACE-OVERLAP (objects) and V-PLACE-BLOCK (terrain) keep building off a locked
 * footprint only while the object stands in state, which this rule guarantees.
 */
import { CommandType } from '../core/model/types';
import { bodyEvidence } from '../core/grid/footprint';
import { objectRect } from '../state/object-geometry';
import { definePreRule } from './define';

export const lockedObjectRule = definePreRule({
  id: 'V-LOCK-02',
  appliesTo: [CommandType.RemoveObject],
  validate(cmd, state, fail) {
    const obj = state.objects.get(cmd.objectId);
    if (obj?.locked) {
      // Evidence = the locked object's whole footprint (what the user tried to remove).
      return [fail('error.locked_immutable', bodyEvidence([objectRect(obj)]))];
    }
    return [];
  },
});
