/**
 * V-PLACE-MAX: per-item placement cap (pre-command).
 *
 * An item with `maxCount` set may exist on the map at most that many times.
 * Used for one-of-a-kind facilities/buildings (e.g. the neighbour center,
 * My House, each unique cabin) which set maxCount: 1. Items without the field
 * are unlimited. Validation runs before the object is added, so the new object
 * is NOT yet in state.objects — reject once the existing count reaches the cap.
 */
import {
  CommandType,
  type Command,
  type GridState,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { getFootprint } from '../core/model/grid-model';
import { getCatalogItem } from '../state/catalog';
import { getPlacedObjectSize } from '../state/object-geometry';
import { getObjectIndex } from '../state/object-index';

export const placementMaxCountRule: PreCommandRule = {
  id: 'V-PLACE-MAX',
  agentHint: 'Items with maxCount are limited. EVERY cabin/house building is UNIQUE (max=1) — a village uses ONE of each DIFFERENT cabin (see CATALOG for the list) plus building-stall, the only repeatable building, for extras. Never place the same building id twice; never batch identical houses.',
  phase: 'pre-command',
  appliesTo: [CommandType.PlaceObject],

  validate(cmd: Command, state: GridState): ValidationError[] {
    if (cmd.type !== CommandType.PlaceObject) return [];
    const item = getCatalogItem(cmd.object.catalogId);
    if (!item || item.maxCount === undefined) return [];

    const count = getObjectIndex(state).countByCatalog.get(cmd.object.catalogId) ?? 0;
    if (count >= item.maxCount) {
      // Non-spatial rule: the evidence is the whole attempted (rotated) footprint.
      const { w, h } = getPlacedObjectSize(cmd.object);
      return [{
        ruleId: 'V-PLACE-MAX',
        message: 'error.max_count',
        messageParams: { n: item.maxCount },
        cells: getFootprint(cmd.object.position.x, cmd.object.position.y, w, h),
        grid: 'macro',
        severity: 'error',
      }];
    }
    return [];
  },
};
