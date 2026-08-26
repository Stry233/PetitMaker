/**
 * V-PLACE-COATED: nothing stands on a road (post-stroke).
 *
 * A surface coating is walked on, so an object sitting on top of one is not buildable in-game.
 * Most paths strip the coating first and never reach this rule: the placer does, the drag/group
 * move does (`stripCoatingsFor`), the agent's place tool does, and generation refuses those cells
 * outright. `EditorAPI.placeObject` deliberately does not, so a programmatic placement onto a road
 * is reverted here rather than producing a map the game cannot build.
 *
 * POST-STROKE, not pre-command, and that is forced rather than chosen. V-PLACE-OVERLAP
 * deliberately exempts coatings so a coating never blocks a placement, because the same
 * validation answers the pre-click PROBE the placement ghost and cursor run: at hover time the
 * road is still there, and refusing then would paint the ghost red over a placement that is
 * perfectly legal once the click strips. Only the finished stroke can tell "coated over" from
 * "left sitting on".
 *
 * EXEMPT: bridges and ramps. A crossing is paved ACROSS on purpose — the generator routes the
 * road bank-to-bank over the deck — so a road overlapping one is the intended arrangement, not a
 * violation. Coatings themselves are exempt for the same reason they are exempt from the overlap
 * rule: one road replacing another is the brush repainting. And flora on a PLANTABLE coating is
 * the game's own arrangement — flowers and crops grow on the dirt path (standsOnCoating).
 */
import {
  ItemCategory,
  type GridState,
  type PostStrokeRule,
  type Rect,
  type ValidationError,
} from '../core/model/types';
import { bodyEvidence, rectsOverlap } from '../core/model/grid-model';
import { standsOnCoating } from '../core/model/traits';
import { getCatalogItem } from '../state/catalog';
import { getObjectIndex } from '../state/object-index';

/** A crossing's deck is a road SURFACE, so pavement over it is the design, not an overlap. */
function isCrossing(catalogId: string): boolean {
  const cat = getCatalogItem(catalogId)?.category;
  return cat === ItemCategory.Bridge || cat === ItemCategory.Ramp;
}

export const objectOnCoatingRule: PostStrokeRule = {
  id: 'V-PLACE-COATED',
  agentHint: 'Objects cannot stand on a road, except flora on the plantable dirt path. Remove the road first, or place elsewhere.',
  phase: 'post-stroke',

  validate(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[] {
    const index = getObjectIndex(state);
    const coatings = index.entries.filter((e) => e.coating);
    if (coatings.length === 0) return [];

    // Evidence = the region where the standing object meets the road, one rect per pair: an
    // anchor on the half grid (a ramp end, the plaza) makes that region fractional, and whole
    // cells would shade past both bodies.
    const evidence: Rect[] = [];
    for (const e of index.entries) {
      if (e.coating || isCrossing(e.obj.catalogId)) continue;
      if (opts?.firstOnly && evidence.length > 0) break;
      const item = getCatalogItem(e.obj.catalogId);
      for (const road of coatings) {
        if (standsOnCoating(item, getCatalogItem(road.obj.catalogId)!)) continue;
        if (!rectsOverlap(e.rect, road.rect)) continue;
        const x0 = Math.max(e.rect.x, road.rect.x), x1 = Math.min(e.rect.x + e.rect.w, road.rect.x + road.rect.w);
        const y0 = Math.max(e.rect.y, road.rect.y), y1 = Math.min(e.rect.y + e.rect.h, road.rect.y + road.rect.h);
        evidence.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        // The auto-revert loop re-validates after every undone command and only needs yes/no.
        if (opts?.firstOnly) break;
      }
    }
    if (evidence.length === 0) return [];
    return [{
      ruleId: 'V-PLACE-COATED',
      message: 'error.object_on_road',
      ...bodyEvidence(evidence),
      grid: 'macro',
      severity: 'error',
    }];
  },
};
