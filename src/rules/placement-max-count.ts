/**
 * V-PLACE-MAX: per-item placement cap (pre-command).
 *
 * An item with `maxCount` set may exist on the map at most that many times.
 * Used for one-of-a-kind items, which set maxCount: 1. Items without the field
 * are unlimited. Validation runs before the object is added, so the new object
 * is not yet in state.objects — reject once the existing count reaches the cap.
 */
import { CommandType } from '../core/model/types';
import { bodyEvidence } from '../core/grid/footprint';
import { getCatalogItem } from '../state/catalog';
import { objectRect } from '../state/object-geometry';
import { getObjectIndex } from '../state/object-index';
import { definePreRule } from './define';

export const placementMaxCountRule = definePreRule({
  id: 'V-PLACE-MAX',
  appliesTo: [CommandType.PlaceObject],

  validate(cmd, state, fail) {
    const item = getCatalogItem(cmd.object.catalogId);
    if (!item || item.maxCount === undefined) return [];

    const count = getObjectIndex(state).countByCatalog.get(cmd.object.catalogId) ?? 0;
    if (count >= item.maxCount) {
      // Non-spatial rule: the evidence is the whole attempted (rotated) footprint.
      return [fail('error.max_count', bodyEvidence([objectRect(cmd.object)]), { messageParams: { n: item.maxCount } })];
    }
    return [];
  },
});
