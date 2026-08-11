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
 * rule: one road replacing another is the brush repainting.
 */
import {
  ItemCategory,
  type GridState,
  type MacroCoord,
  type PostStrokeRule,
  type ValidationError,
} from '../core/model/types';
import { cellKey, rectsOverlap } from '../core/model/grid-model';
import { getCatalogItem } from '../state/catalog';
import { getObjectIndex } from '../state/object-index';

/** A crossing's deck is a road SURFACE, so pavement over it is the design, not an overlap. */
function isCrossing(catalogId: string): boolean {
  const cat = getCatalogItem(catalogId)?.category;
  return cat === ItemCategory.Bridge || cat === ItemCategory.Ramp;
}

export const objectOnCoatingRule: PostStrokeRule = {
  id: 'V-PLACE-COATED',
  agentHint: 'Objects cannot stand on a road. Remove the road first, or place elsewhere.',
  phase: 'post-stroke',

  validate(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[] {
    const index = getObjectIndex(state);
    const coatings = index.entries.filter((e) => e.coating);
    if (coatings.length === 0) return [];

    const evidence: MacroCoord[] = [];
    const seen = new Set<string>();
    for (const e of index.entries) {
      if (e.coating || isCrossing(e.obj.catalogId)) continue;
      if (opts?.firstOnly && evidence.length > 0) break;
      for (const road of coatings) {
        if (!rectsOverlap(e.rect, road.rect)) continue;
        const x0 = Math.floor(Math.max(e.rect.x, road.rect.x));
        const x1 = Math.ceil(Math.min(e.rect.x + e.rect.w, road.rect.x + road.rect.w));
        const y0 = Math.floor(Math.max(e.rect.y, road.rect.y));
        const y1 = Math.ceil(Math.min(e.rect.y + e.rect.h, road.rect.y + road.rect.h));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const key = cellKey(x, y);
            if (!seen.has(key)) { seen.add(key); evidence.push({ x, y }); }
          }
        }
        // The auto-revert loop re-validates after every undone command and only needs yes/no.
        if (opts?.firstOnly) break;
      }
    }
    if (evidence.length === 0) return [];
    return [{
      ruleId: 'V-PLACE-COATED',
      message: 'error.object_on_road',
      cells: evidence,
      grid: 'macro',
      severity: 'error',
    }];
  },
};
