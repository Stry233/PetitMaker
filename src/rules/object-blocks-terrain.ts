/**
 * V-PLACE-BLOCK: Terrain paint/erase restrictions around objects (pre-command).
 *
 * A terrain cell is blocked when it overlaps an object's footprint on the terrain
 * micro-grid: terrain occupies the half-tile-shifted micro grid, so a cell spans
 * [x−0.5, x+0.5] (the dual-grid offset is documented in docs/ARCHITECTURE.md).
 * A road (surfaceCoating) blocks neither mountain paint nor erase: a coating follows
 * its surface, and `commitStroke`'s road reconcile carries it to the new level or
 * removes it where the ground went mixed (core/domain/edge-cut/road-reconcile). Water paint
 * stays blocked on road cells, and everything is blocked by any solid object —
 * including an immutable landmark, which is just a solid object here.
 */
import { CommandType, TerrainType } from '../core/model/types';
import { type Rect, rectsOverlap } from '../core/grid/rect';
import { getCell } from '../core/model/grid-model';
import { bodyEvidence } from '../core/grid/footprint';
import { addedPatchCorners, cornerQuadrantRect } from '../core/domain/edge-cut/patch-corners';
import { entriesNear, getObjectIndex, type ObjectIndex, type ObjectIndexEntry } from '../state/object-index';
import { terrainCellRect } from '../core/grid/grid-convert';
import { definePreRule } from './define';

/** The objects standing in the way of terrain at `fp`, a rect on the terrain micro-grid. A coating
 *  lets the terrain through when `coatingFollows`. */
function blockersAt(index: ObjectIndex, fp: Rect, coatingFollows: boolean): ObjectIndexEntry[] {
  return entriesNear(index, fp).filter((e) => rectsOverlap(e.rect, fp) && !(coatingFollows && e.coating));
}

/** Whether an object blocks a terrain paint or erase of the macro cell at (x, y): the rule's own
 *  per-cell test against `getObjectIndex(state)`, for planners that must leave such a cell out rather than be refused. */
export function objectBlocksTerrainCell(index: ObjectIndex, x: number, y: number, coatingFollows: boolean): boolean {
  return blockersAt(index, terrainCellRect({ x, y }), coatingFollows).length > 0;
}

export const objectBlocksTerrainRule = definePreRule({
  id: 'V-PLACE-BLOCK',
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain, CommandType.TrimCorners],

  validate(cmd, state, fail) {
    // The rects this command puts terrain at, plus whether a coating lets it through: a road follows
    // a mountain paint up and an erase down, so neither is blocked over one. A plain edge cut only
    // removes/reveals (never adds), and never sits on an object cell (no terrain there), so it's exempt.
    //
    // A Γ patch (patchOnly TrimCorners) materialises cosmetic terrain, so it is gated like a paint —
    // over the corner quadrants it raises to its tier, not over its whole cell. A patch corner is a
    // column walled inside its own quadrant, and the half-tile shift makes a 1x1 object exactly the
    // four quadrants meeting at its corner, so the test is exact rather than approximate. Judged by
    // its whole cell instead, a from-empty fillet three quadrants away from the object is refused,
    // and a Γ notch beside a tree cannot round. This is not a blanket relaxation:
    // a patch materialised over a hidden block carries 'square' on its other corners and so raises
    // the whole cell's silhouette, and `addedPatchCorners` reports all four for it.
    let footprints: readonly Rect[];
    let coatingFollows: boolean;
    if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
      footprints = cmd.cells.map(terrainCellRect);
      coatingFollows = cmd.type === CommandType.EraseTerrain
        || (cmd.type === CommandType.PaintTerrain && cmd.terrainType === TerrainType.Mountain);
    } else if (cmd.type === CommandType.TrimCorners && cmd.layer === 'terrain' && cmd.patchOnly) {
      // A patch re-seating to a taller tier (the auto pass, tracking walls that have since stacked)
      // reports the same corners it already held, but every one of them grows a taller column, so a
      // rise is judged by all of them. A patch is cosmetic, so placement reads the ground through it
      // and an object can legitimately be standing in a fillet's quadrant by the time the walls rise.
      const standing = getCell(state.cells, cmd.x, cmd.y)?.terrain;
      const standingPatch = standing?.patchOnly ? standing : undefined;
      footprints = addedPatchCorners(standingPatch?.corners, cmd.afterCorners, (cmd.elevation ?? 0) > (standingPatch?.elevation ?? 0))
        .map((i) => cornerQuadrantRect(cmd.x, cmd.y, i));
      coatingFollows = cmd.terrainType === TerrainType.Mountain;
    } else {
      return [];
    }

    // Spatial-index candidates per footprint: this rule runs once per PaintTerrain
    // command (dozens per brush stroke), and a decorated map holds thousands of
    // objects — only the handful near each cell can possibly block it.
    // Evidence = the blocking objects' own drawn footprints, on the object grid: the cause
    // is the object standing in the way, and a flash on the shifted terrain cell
    // straddles that object's sprite by half a tile and reads as noise. The footprint is
    // carried as the rect it is drawn at, not as the cells it touches — a landmark's rect
    // starts at x.5, so a whole-cell list would shade half a cell past it on every side.
    const index = getObjectIndex(state);
    const blockers = new Map<number, Rect>(); // ord → drawn footprint (each blocker once)
    for (const fp of footprints) {
      for (const e of blockersAt(index, fp, coatingFollows)) if (!blockers.has(e.ord)) blockers.set(e.ord, e.rect);
    }
    if (blockers.size > 0) {
      const rects = [...blockers.keys()].sort((a, b) => a - b).map((ord) => blockers.get(ord)!);
      return [fail('error.object_blocks_terrain', bodyEvidence(rects))];
    }
    return [];
  },
});
