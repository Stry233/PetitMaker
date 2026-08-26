/**
 * V-PLACE-OVERLAP: No two objects may overlap (pre-command).
 *
 * AABB overlap between the new object's footprint rect and every existing
 * object's rect (macro grid, touching edges allowed). `objectRect` returns the
 * fractional rect for the plaza and the integer rect for normal items, so the
 * immutable plaza needs no special case — it's just another object here.
 */
import {
  CommandType,
  type Command,
  type GridState,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { bodyEvidence, rectsOverlap, type Rect } from '../core/model/grid-model';
import { isCoating, standsOnCoating } from '../core/model/traits';
import { getCatalogItem } from '../state/catalog';
import { objectRect } from '../state/object-geometry';
import { entriesCovering, getObjectIndex } from '../state/object-index';

/** The overlap of two rects, as a rect. Fractional by construction wherever either body is (the
 *  plaza's x.5 origin, a ramp/bridge anchor) — `bodyEvidence` turns it into both the drawn shade
 *  and the whole cells reported alongside it. */
function intersectionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const placementOverlapRule: PreCommandRule = {
  id: 'V-PLACE-OVERLAP',
  agentHint: 'Object footprints may not overlap (touching edges is fine).',
  phase: 'pre-command',
  appliesTo: [CommandType.PlaceObject],

  validate(cmd: Command, state: GridState): ValidationError[] {
    if (cmd.type !== CommandType.PlaceObject) return [];
    const newRect = objectRect(cmd.object);
    const candidate = getCatalogItem(cmd.object.catalogId);

    // Evidence = the region where the new footprint intersects each blocker,
    // accumulated across ALL blockers (one error, one rect per blocker).
    // Candidates come from the spatial index, by CELL rather than by chunk: a
    // placement asks this once per attempt, generation makes thousands of
    // attempts on a decorated map, and a chunk bucket of a paved region holds
    // every road in it.
    const evidence: Rect[] = [];
    for (const e of entriesCovering(getObjectIndex(state), newRect)) {
      if (e.obj.id === cmd.object.id) continue; // skip self (a move/rotate re-place)
      // A surface coating (road/path) is meant to be coated OVER — the placer strips any coating the new
      // footprint covers — so it never blocks a SOLID's placement. That is what lets a building's ghost
      // read green over a road and the strip happen AFTER validation: stripping first would leave the road
      // gone whenever the placement is then rejected (see ObjectPlacerTool.onPointerDown).
      // A coating CANDIDATE gets no such pass: every legitimate re-coat strips first, so two coatings on
      // one cell is a state nothing may create — whichever is asked about later answers for both.
      if (e.coating && !(candidate && isCoating(candidate))) continue;
      // The other direction of the plantable pair: a plantable road painted UNDER standing flora
      // coexists with it — which is also what lets the road-follow reconcile re-seat a planted
      // dirt path when the ground under the pair changes.
      if (candidate && standsOnCoating(getCatalogItem(e.obj.catalogId), candidate)) continue;
      if (!rectsOverlap(newRect, e.rect)) continue;
      evidence.push(intersectionRect(newRect, e.rect));
    }
    if (evidence.length > 0) {
      return [{
        ruleId: 'V-PLACE-OVERLAP',
        message: 'error.object_overlap',
        ...bodyEvidence(evidence),
        grid: 'macro',
        severity: 'error',
      }];
    }
    return [];
  },
};
