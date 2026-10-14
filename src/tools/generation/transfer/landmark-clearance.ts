// The repair every load path runs on a decoded map before it is installed: `decodeSave` returns the
// map as saved, and this step works on that detached `GridState`, not a kit context, and returns
// what it removed.
import type { GridState, MacroCell, PlacedObject } from '../../../core/model/types';
import { holdsTemplateTerrain, templateTerrainAt } from '../../../core/model/template';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { isLaidLandmark } from '../../../core/model/landmarks';
import { cellKey, rectsOverlap } from '../../../core/grid/rect';
import { footprintTerrain } from '../../../core/grid/footprint';
import { createDefaultRegistry } from '../../../rules';
import { objectRect } from '../../../state/object-geometry';
import { entriesCovering, getObjectIndex } from '../../../state/object-index';
import { backOffAt, type SettleActions } from '../../../state/settle';

/** What a load took off the map because a landmark now stands over it: objects whose footprint
 *  overlaps a landmark's, terrain on the cells it rests on other than its template's, and whatever
 *  those removals left standing against the map rules. `restored` counts the cells that got back the
 *  terrain their template lays under a landmark, which saves written before that terrain was saved
 *  leave empty; restoring it removes nothing the visitor made. */
export interface LandmarkClearance { objects: number; cells: number; restored: number }


/**
 * Removes from `state` the objects its landmarks stand over and the terrain on the cells they rest
 * on, counting them, and gives each of those cells exactly the terrain its template lays there (the
 * mountain a built-in plaza stands on), so the ground under a landmark is always the template's. A
 * map the rules built holds none; a map saved before a landmark moved or grew may. A removed
 * object's taint goes with it.
 * Taking terrain away can leave water uncontained or a block unsupported, and a map that breaks a
 * post-stroke rule refuses every later stroke, so whatever the rules then flag is taken back too
 * (`state/settle.ts:backOffAt`), around the template's ground and never into it, until the rules
 * pass or a round removes nothing.
 */
export function clearUnderLandmarks(state: GridState): LandmarkClearance {
  const cleared: LandmarkClearance = { objects: 0, cells: 0, restored: 0 };
  const landmarks = [...state.objects.values()].filter(isLaidLandmark).map((o) => objectRect(o));
  if (landmarks.length === 0) return cleared;
  const removed: PlacedObject[] = [];
  const dropObject = (o: PlacedObject) => {
    state.objects.delete(o.id);
    state.provenance?.objectTaint.delete(o.id);
    removed.push(o);
    cleared.objects++;
  };
  const dropTerrain = (cell: MacroCell) => { cell.terrain = null; cleared.cells++; };
  for (const o of [...state.objects.values()]) {
    if (o.locked) continue;
    const rect = objectRect(o);
    if (landmarks.some((l) => rectsOverlap(l, rect))) dropObject(o);
  }
  // Terrain a template lays under a landmark is fixed; the settle below repairs around it, never into it.
  const held = new Set<string>();
  for (const l of landmarks) {
    const under = footprintTerrain(l);
    for (let y = Math.max(0, under.y); y < Math.min(state.template.height, under.y + under.h); y++) {
      for (let x = Math.max(0, under.x); x < Math.min(state.template.width, under.x + under.w); x++) {
        const cell = state.cells[y]?.[x];
        if (!cell) continue;
        const laid = templateTerrainAt(state.template, x, y, cell.zone);
        if (laid) held.add(cellKey(x, y));
        if (holdsTemplateTerrain(state.template, x, y, cell)) continue;
        if (cell.terrain) dropTerrain(cell);
        if (laid) { cell.terrain = laid; cleared.restored++; }
      }
    }
  }
  if (cleared.objects + cleared.cells + cleared.restored === 0) return cleared;
  bumpObjectsVersion(state, { removed: removed.splice(0) });
  const rules = createDefaultRegistry();
  const act: SettleActions = {
    eraseTerrain: (c) => { dropTerrain(state.cells[c.y]![c.x]!); return true; },
    removeObject: (o) => { dropObject(o); return true; },
  };
  // The first unlocked object over the cell in map order. Objects a round drops leave the index only
  // when the round ends, so the index is read through what still stands.
  const standingAt = (c: { x: number; y: number }) => {
    const cellRect = { x: c.x, y: c.y, w: 1, h: 1 };
    return entriesCovering(getObjectIndex(state), cellRect)
      .find((e) => state.objects.has(e.obj.id) && !e.obj.locked && rectsOverlap(e.rect, cellRect))?.obj;
  };
  // Every round removes something or ends the settle, so it stops within the map's cell and object count.
  for (;;) {
    const violations = rules.validatePostStroke(state);
    if (violations.length === 0) break;
    const before = cleared.objects + cleared.cells;
    const seen = new Set<string>();
    for (const v of violations) {
      for (const c of v.cells) {
        const key = cellKey(c.x, c.y);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!state.cells[c.y]?.[c.x]) continue;
        backOffAt(state, act, c, { standingAt, held });
      }
    }
    bumpObjectsVersion(state, { removed: removed.splice(0) });
    if (cleared.objects + cleared.cells === before) break;
  }
  return cleared;
}
