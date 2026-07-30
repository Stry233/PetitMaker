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
  type MacroCoord,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { cellKey, rectsOverlap, type Rect } from '../core/model/grid-model';
import { objectRect } from '../state/object-geometry';
import { entriesNear, getObjectIndex } from '../state/object-index';

/** The macro cells covered by the intersection of two overlapping rects — the
 *  evidence for an overlap error. floor/ceil handles fractional rects (the plaza). */
function intersectionCells(a: Rect, b: Rect): MacroCoord[] {
  const x0 = Math.floor(Math.max(a.x, b.x)), x1 = Math.ceil(Math.min(a.x + a.w, b.x + b.w));
  const y0 = Math.floor(Math.max(a.y, b.y)), y1 = Math.ceil(Math.min(a.y + a.h, b.y + b.h));
  const cells: MacroCoord[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      cells.push({ x, y });
  return cells;
}

export const placementOverlapRule: PreCommandRule = {
  id: 'V-PLACE-OVERLAP',
  agentHint: 'Object footprints may not overlap (touching edges is fine).',
  phase: 'pre-command',
  appliesTo: [CommandType.PlaceObject],

  validate(cmd: Command, state: GridState): ValidationError[] {
    if (cmd.type !== CommandType.PlaceObject) return [];
    const newRect = objectRect(cmd.object);

    // Evidence = the cells where the new footprint intersects each blocker,
    // accumulated across ALL blockers (one error; deduped for shared cells).
    // Candidates come from the spatial index: a placement asks this once per
    // attempt, and generation makes thousands of attempts on a decorated map.
    const evidence: MacroCoord[] = [];
    const seen = new Set<string>();
    for (const e of entriesNear(getObjectIndex(state), newRect)) {
      if (e.obj.id === cmd.object.id) continue; // skip self (a move/rotate re-place)
      // A surface coating (road/path) is meant to be coated OVER — the placer removes any coating the new
      // footprint covers — so it never blocks placement. (Without this, hovering a building over a road
      // flagged the ghost red and the placer had to strip the road BEFORE validating, which left the road
      // gone even when the placement was then rejected. See ObjectPlacerTool.onPointerDown.)
      if (e.coating) continue;
      if (!rectsOverlap(newRect, e.rect)) continue;
      for (const c of intersectionCells(newRect, e.rect)) {
        const key = cellKey(c.x, c.y);
        if (!seen.has(key)) { seen.add(key); evidence.push(c); }
      }
    }
    if (evidence.length > 0) {
      return [{
        ruleId: 'V-PLACE-OVERLAP',
        message: 'error.object_overlap',
        cells: evidence,
        grid: 'macro',
        severity: 'error',
      }];
    }
    return [];
  },
};
