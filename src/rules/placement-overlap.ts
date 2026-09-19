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
  ItemCategory,
  type Command,
  type GridState,
  type PlacedObject,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { bodyEvidence, rectsOverlap, type Rect } from '../core/model/grid-model';
import { isCoating, standsOnCoating } from '../core/model/traits';
import { getCatalogItem } from '../state/catalog';
import { objectElevation, objectRect } from '../state/object-geometry';
import { entriesCovering, getObjectIndex, type ObjectIndexEntry } from '../state/object-index';

/** The overlap of two rects, as a rect. Fractional by construction wherever either body is (the
 *  plaza's x.5 origin, a ramp/bridge anchor) — `bodyEvidence` turns it into both the drawn shade
 *  and the whole cells reported alongside it. */
function intersectionRect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Shared with repaint previews, which may ignore coatings the brush will remove. */
export function placementBlockers(object: PlacedObject, state: GridState): ObjectIndexEntry[] {
  const rect = objectRect(object);
  const candidate = getCatalogItem(object.catalogId);
  const coating = !!candidate && isCoating(candidate);
  const elevation = coating ? objectElevation(state, object) : 0;
  const blockers: ObjectIndexEntry[] = [];
  for (const entry of entriesCovering(getObjectIndex(state), rect)) {
    if (entry.obj.id === object.id) continue;
    // Solid placement strips existing coatings after its preview validates; repainting strips first.
    if (entry.coating && !coating) continue;
    if (candidate && standsOnCoating(entry.item, candidate)) continue;
    // Pavement follows the ground beneath the deck; bridge landings and ramps remain occupied.
    if (coating && entry.item?.category === ItemCategory.Bridge && elevation < entry.obj.elevation) continue;
    if (rectsOverlap(rect, entry.rect)) blockers.push(entry);
  }
  return blockers;
}

export const placementOverlapRule: PreCommandRule = {
  id: 'V-PLACE-OVERLAP',
  agentHint: 'Object footprints may not overlap (touching edges is fine). Roads may pass beneath a higher bridge on valid dry ground.',
  phase: 'pre-command',
  appliesTo: [CommandType.PlaceObject],

  validate(cmd: Command, state: GridState): ValidationError[] {
    if (cmd.type !== CommandType.PlaceObject) return [];
    const newRect = objectRect(cmd.object);
    const evidence = placementBlockers(cmd.object, state).map(e => intersectionRect(newRect, e.rect));
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
