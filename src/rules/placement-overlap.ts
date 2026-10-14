/**
 * V-PLACE-OVERLAP: No two objects may overlap (pre-command).
 *
 * AABB overlap between the new object's footprint rect and every existing
 * object's rect (macro grid, touching edges allowed). `objectRect` returns the
 * fractional rect for a self-sized landmark and the integer rect for normal items, so
 * a locked landmark needs no special case here.
 * A placement under an id another standing object holds is refused the same way (`repeatsLiveId`).
 */
import { CommandType, type GridState, type PlacedObject, type StrokeScope } from '../core/model/types';
import { bodyEvidence } from '../core/grid/footprint';
import { rectIntersection, rectsOverlap } from '../core/grid/rect';
import { isBridge, isCoating, isCoatingItem, standsOnCoating, coatingLayer } from '../core/model/traits';
import { getCatalogItem } from '../state/catalog';
import { objectElevation, objectRect } from '../state/object-geometry';
import { entriesCovering, getObjectIndex, type ObjectIndexEntry } from '../state/object-index';
import { definePreRule } from './define';

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
    if (coating && entry.coating && coatingLayer(candidate) !== coatingLayer(entry.item)) continue;
    if (coating && candidate && standsOnCoating(entry.item, candidate)) continue;
    // Pavement follows the ground beneath the deck; bridge landings and ramps remain occupied.
    if (coating && isBridge(entry.item) && elevation < entry.obj.elevation) continue;
    if (rectsOverlap(rect, entry.rect)) blockers.push(entry);
  }
  return blockers;
}

/** Whether placing `object` would put a second object under an id the map already holds. `objects`
 *  is keyed by id, so a repeat would replace that object, leave its old sprite drawn and lose it on
 *  undo. An object the open stroke lifted is being moved, and a candidate of the same item at the
 *  standing object's own anchor re-describes it in place (a road re-seated at a new level is probed
 *  with the old road still standing). */
function repeatsLiveId(object: PlacedObject, state: GridState, scope: StrokeScope | undefined): boolean {
  const standing = state.objects.get(object.id);
  if (!standing || scope?.lifted.has(standing.id)) return false;
  return standing.catalogId !== object.catalogId
    || standing.position.x !== object.position.x || standing.position.y !== object.position.y;
}

/** Whether a coating on `state` overlaps what the placement rule now refuses, as maps saved before
 *  the rule may carry. */
export function hasCoatingConflict(state: GridState): boolean {
  return [...state.objects.values()].some((object) =>
    isCoatingItem(getCatalogItem(object.catalogId)) && placementBlockers(object, state).some((entry) => entry.coating));
}

export const placementOverlapRule = definePreRule({
  id: 'V-PLACE-OVERLAP',
  appliesTo: [CommandType.PlaceObject],

  validate(cmd, state, fail, scope) {
    if (repeatsLiveId(cmd.object, state, scope)) {
      const standing = state.objects.get(cmd.object.id)!;
      return [fail('error.object_overlap', bodyEvidence([objectRect(standing)]))];
    }
    const newRect = objectRect(cmd.object);
    const evidence = placementBlockers(cmd.object, state).map(e => rectIntersection(newRect, e.rect));
    if (evidence.length > 0) {
      return [fail('error.object_overlap', bodyEvidence(evidence))];
    }
    return [];
  },
});
