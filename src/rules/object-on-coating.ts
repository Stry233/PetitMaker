/** Finished strokes must leave each solid object on a compatible surface. */
import { type Rect, rectIntersection, rectsOverlap } from '../core/grid/rect';
import { bodyEvidence } from '../core/grid/footprint';
import { isCrossing, standsOnCoating } from '../core/model/traits';
import { entriesCovering, getObjectIndex } from '../state/object-index';
import { definePostRule } from './define';

export const objectOnCoatingRule = definePostRule({
  id: 'V-PLACE-COATED',

  validate(state, opts, fail) {
    const index = getObjectIndex(state);
    if (!index.entries.some((e) => e.coating)) return [];

    // Evidence = the region where the standing object meets the road, one rect per pair: an
    // anchor on the half grid (a ramp end, a landmark) makes that region fractional, and whole
    // cells would shade past both bodies. Candidates come off the cell buckets: an overlap has
    // area, so it lies in a cell both footprints touch, and the ord sort keeps evidence order.
    const evidence: Rect[] = [];
    for (const e of index.entries) {
      if (e.coating || isCrossing(e.item)) continue;
      if (opts?.firstOnly && evidence.length > 0) break;
      for (const road of entriesCovering(index, e.rect)) {
        if (!road.coating) continue;
        if (standsOnCoating(e.item, road.item!)) continue;
        if (!rectsOverlap(e.rect, road.rect)) continue;
        evidence.push(rectIntersection(e.rect, road.rect));
        // The auto-revert loop re-validates after every undone command and only needs yes/no.
        if (opts?.firstOnly) break;
      }
    }
    if (evidence.length === 0) return [];
    return [fail('error.object_on_road', bodyEvidence(evidence))];
  },
});
