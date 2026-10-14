/* The coating strip: which roads and tiles an object laid over them replaces, read through the
 * spatial index, and the removals that make room for it in the caller's stroke. */
import { removeObjectCommand } from '../../core/model/command-build';
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { CommandSink } from '../../core/model/command-sink';
import type { CatalogItem, GridState, MacroCoord, PlacedObject, ValidationError } from '../../core/model/types';
import { replacesCoating, isCoatingItem, coatingLayer } from '../../core/model/traits';
import { getCatalogItem } from '../../state/catalog';
import { cellKey } from '../../core/grid/rect';
import { getFootprint } from '../../core/grid/footprint';
import { getPlacedObjectSize, snapsOwnPlacement } from '../../state/object-geometry';
import { entriesNear, getObjectIndex } from '../../state/object-index';
import { placementBlockers, placementOverlapRule } from '../../rules/placement-overlap';

/**
 * The coating (road/tile) objects covering any of `footprint`. Only objects near the footprint can
 * overlap it, so this asks the spatial index rather than scanning all objects: the tile brush needs
 * it once per painted cell, and a scan would make a large fill cost (cells x objects).
 *
 * Shared by the coat-over removal below and the eraser's pre-click probe, so what the eraser says
 * it will remove is what a click removes.
 */
export function overlappingCoatings(gs: GridState, footprint: MacroCoord[], layer?: number): PlacedObject[] {
  if (footprint.length === 0) return [];
  const cells = new Set(footprint.map(c => cellKey(c.x, c.y)));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of footprint) {
    if (c.x < x0) x0 = c.x;
    if (c.x > x1) x1 = c.x;
    if (c.y < y0) y0 = c.y;
    if (c.y > y1) y1 = c.y;
  }
  const near = entriesNear(getObjectIndex(gs), { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  const hits: PlacedObject[] = [];
  for (const entry of near) {
    if (!entry.coating || (layer !== undefined && coatingLayer(entry.item) !== layer)) continue;
    const { x, y, w, h } = entry.rect;
    let hit = false;
    for (let dy = 0; dy < h && !hit; dy++) {
      for (let dx = 0; dx < w && !hit; dx++) hit = cells.has(cellKey(x + dx, y + dy));
    }
    if (hit) hits.push(entry.obj);
  }
  return hits;
}


/**
 * The coatings on `cells` that laying `item` there replaces: its own layer for a coating, every
 * coating it cannot stand on for a solid (flora keeps a plantable road, a structure with
 * `coatingSupport` keeps its road), nothing for a crossing, which may stand over pavement. With no
 * item, every coating on `layer` (or on any layer).
 */
function coatingsToStrip(gs: GridState, cells: MacroCoord[], item?: CatalogItem, layer?: number): PlacedObject[] {
  return overlappingCoatings(gs, cells, isCoatingItem(item) ? coatingLayer(item) : layer)
    .filter((obj) => replacesCoating(item, getCatalogItem(obj.catalogId)!));
}

/**
 * The one coating-strip plan for placing `dest`: the coatings under its footprint that it replaces,
 * itself excluded (a road being moved is not a coating to strip). The placer, every move, the road
 * paver and the assistant's `place_object` strip exactly these, in the stroke that places `dest`.
 *
 * V-PLACE-OVERLAP exempts coatings, so landing on a road is legal and raises nothing: without the
 * strip the object would sit on a road that is still there.
 *
 * A snapping item (bridge/ramp) strips nothing: its command's position is decided by the trait at
 * execute time, so `dest` is not where it will stand, and a deck over a road is legal anyway
 * (V-PLACE-COATED exempts crossings).
 */
export function coatingStripFor(gs: GridState, dest: PlacedObject, item = getCatalogItem(dest.catalogId)): PlacedObject[] {
  if (!item || snapsOwnPlacement(item)) return [];
  const { w, h } = getPlacedObjectSize(dest, item);
  return coatingsToStrip(gs, getFootprint(dest.position.x, dest.position.y, w, h), item)
    .filter((obj) => obj.id !== dest.id);
}

/** Strip the coatings on `footprint` that `forItem` replaces (`coatingsToStrip`), so the caller
 *  can coat over them. The set is resolved before the removals, so the commands cannot disturb it. */
export function removeOverlappingCoatings(
  footprint: MacroCoord[], ctx: CommandSink, forItem?: CatalogItem, layer?: number,
): void {
  for (const obj of coatingsToStrip(ctx.state, footprint, forItem, layer)) ctx.execute(removeObjectCommand(obj));
}

/** `coatingStripFor`, executed, for callers holding an executor rather than a command sink: a drag,
 *  a group move, a group rotation, the road paver. The caller owns the stroke, so the removals undo
 *  with the placement they made room for. */
export function stripCoatingsFor(
  executor: CommandExecutor, gs: GridState, dest: PlacedObject,
): void {
  for (const obj of coatingStripFor(gs, dest)) executor.execute(removeObjectCommand(obj));
}

/**
 * Whether a placement refusal is only the coating the tile click strips first, the one refusal the
 * click makes legal. Shared by the cursor probe and the road-trim ghost, so every promise matches
 * what the click commits: a coating over a coating is refused outright by V-PLACE-OVERLAP, and only
 * the strip-then-place pair gets past it.
 */
export function strippableRefusal(gs: GridState, object: PlacedObject, errors: readonly ValidationError[]): boolean {
  if (errors.length === 0 || !errors.every((e) => e.ruleId === placementOverlapRule.id)) return false;
  const blockers = placementBlockers(object, gs);
  return blockers.length > 0 && blockers.every(e => e.coating);
}
