/**
 * V-PLACE-BLOCK: Terrain paint/erase restrictions around objects (pre-command).
 *
 * A terrain cell is blocked when it overlaps an object's footprint on the terrain
 * micro-grid: terrain occupies the half-tile-shifted micro grid, so a cell spans
 * [x−0.5, x+0.5] (the dual-grid offset is documented in docs/ARCHITECTURE.md).
 * A road (surfaceCoating) blocks neither mountain paint nor erase: a coating follows
 * its surface, and `commitStroke`'s road reconcile carries it to the new level or
 * removes it where the ground went mixed (core/commands/road-reconcile). Water paint
 * stays blocked on road cells, and everything is blocked by any solid object —
 * including the immutable plaza, which is just a solid object here.
 */
import {
  CommandType,
  TerrainType,
  type Command,
  type GridState,
  type PreCommandRule,
  type Rect,
  type ValidationError,
} from '../core/model/types';
import { bodyEvidence, getCell, rectsOverlap } from '../core/model/grid-model';
import { addedPatchCorners, cornerQuadrantRect } from '../core/edge-cut/patch-corners';
import { entriesNear, getObjectIndex } from '../state/object-index';

export const objectBlocksTerrainRule: PreCommandRule = {
  id: 'V-PLACE-BLOCK',
  agentHint: 'Terrain cannot be painted on cells covered by an object footprint — clear_area removes the objects AND the terrain there in one step.',
  phase: 'pre-command',
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain, CommandType.TrimCorners],

  validate(cmd: Command, state: GridState): ValidationError[] {
    // The rects this command puts terrain at, plus whether a COATING lets it through: a road follows
    // a mountain paint up and an erase down, so neither is blocked over one. A plain edge cut only
    // removes/reveals (never adds), and never sits on an object cell (no terrain there), so it's exempt.
    //
    // A Γ patch (patchOnly TrimCorners) MATERIALISES cosmetic terrain, so it is gated like a paint —
    // over the CORNER QUADRANTS it raises to its tier, not over its whole cell. A patch corner is a
    // column walled inside its own quadrant, and the half-tile shift makes a 1x1 object exactly the
    // four quadrants meeting at its corner, so the test is exact rather than approximate. Judged by
    // its whole cell instead, a from-empty fillet three quadrants away from the object is refused,
    // and a Γ notch beside a tree cannot round. This is NOT a blanket relaxation:
    // a patch materialised over a hidden block carries 'square' on its other corners and so raises
    // the whole cell's silhouette, and `addedPatchCorners` reports all four for it.
    let footprints: readonly Rect[];
    let coatingFollows: boolean;
    if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
      footprints = cmd.cells.map((c) => ({ x: c.x - 0.5, y: c.y - 0.5, w: 1, h: 1 }));
      coatingFollows = cmd.type === CommandType.EraseTerrain
        || (cmd.type === CommandType.PaintTerrain && cmd.terrainType === TerrainType.Mountain);
    } else if (cmd.type === CommandType.TrimCorners && cmd.layer === 'terrain' && cmd.patchOnly) {
      // A patch RE-SEATING to a taller tier (the auto pass, tracking walls that have since stacked)
      // reports the same corners it already held, but every one of them grows a taller column, so a
      // rise is judged by all of them. A patch is cosmetic, so placement reads the ground THROUGH it
      // and an object can legitimately be standing in a fillet's quadrant by the time the walls rise.
      const standing = getCell(state.cells, cmd.x, cmd.y)?.terrain;
      const standingTier = standing?.patchOnly ? standing.elevation : 0;
      footprints = addedPatchCorners(cmd.beforeCorners, cmd.afterCorners, (cmd.elevation ?? 0) > standingTier)
        .map((i) => cornerQuadrantRect(cmd.x, cmd.y, i));
      coatingFollows = cmd.terrainType === TerrainType.Mountain;
    } else {
      return [];
    }

    // Spatial-index candidates per footprint: this rule runs once per PaintTerrain
    // command (dozens per brush stroke), and a decorated map holds thousands of
    // objects — only the handful near each cell can possibly block it.
    // Evidence = the BLOCKING OBJECTS' own drawn footprints, on the object grid: the cause
    // is the object standing in the way, and a flash on the shifted terrain cell
    // straddles that object's sprite by half a tile and reads as noise. The footprint is
    // carried as the RECT it is drawn at, not as the cells it touches — the plaza's rect
    // starts at x.5, so a whole-cell list would shade half a cell past it on every side.
    const index = getObjectIndex(state);
    const blockers = new Map<number, Rect>(); // ord → drawn footprint (each blocker once)
    for (const fp of footprints) {
      const near = entriesNear(index, fp);
      for (const e of near) {
        if (blockers.has(e.ord)) continue;
        if (!rectsOverlap(e.rect, fp)) continue;
        if (coatingFollows && e.coating) continue; // the road rides the surface change
        blockers.set(e.ord, e.rect);
      }
    }
    if (blockers.size > 0) {
      const rects = [...blockers.keys()].sort((a, b) => a - b).map((ord) => blockers.get(ord)!);
      return [{
        ruleId: 'V-PLACE-BLOCK',
        message: 'error.object_blocks_terrain',
        ...bodyEvidence(rects),
        grid: 'macro',
        severity: 'error',
      }];
    }
    return [];
  },
};
