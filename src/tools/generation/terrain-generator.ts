/**
 * THE GENERATION FACADE, and the only file at this module's root: a recipe in, a built map out.
 *
 * It dispatches `config.algorithm` to one of the three generators beside it, each behind its own
 * door — `designer/` (the island: the methodology pipeline, and the only island generator),
 * `maze/` (a labyrinth carved into the buildable region), `stencil/` (a picture read as terrain) —
 * and all three stand on `core/`, the floor: what a terrain plan is, how it is repaired into a
 * legal one, and how it becomes commands. Putting objects on ground that already exists is
 * `tools/placement/`, a module of its own beside this one: the designer reaches one file of it, and
 * the macros and the agent's director tools reach it without going through any generator at all.
 *
 * A caller wants this file. The shelf and `kit/operations/generate.ts` run a recipe through it, and
 * the evaluation harness runs the same call the app does rather than a private path.
 */
import { CommandType, TerrainType } from '../../core/model/types';
import type { Command, Corners, GridState, MacroCoord, PlacedObject, ResolvedMazeGates, ValidationResult } from '../../core/model/types';
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import { buildObjectOccupancy, objectRect } from '../../state/object-geometry';
import { generateMaze } from './maze/maze-generator';
import { runStencilPlan } from './stencil/stencil-generator';
import { edgeCutGeneratedTerrain, edgeCutTerrainWith } from '../edge-cut/auto-edge-cut';
import { stencilChooser } from './stencil/stencil-trim';
import type { GenerateConfig } from '../../core/model/types';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { generateDesigned, type DesignedOutcome } from './designer';
import { removeObjectCommand } from '../objects/object-placer';

const SQUARE: Corners = ['square', 'square', 'square', 'square'];

/** The refusals a designed run collected. Zero on flat ground; a caller reports them. */
const refusedTotal = (out: DesignedOutcome): number =>
  out.refused.roads + out.refused.anchors + out.refused.lanes;

export interface GenerateResult {
  placed: number;
  skipped: number;
  overwritten: number;
  /** The methodology run's plan and its refusal counts ('designed' algorithm only). */
  designed?: DesignedOutcome;
  /** Where the maze opened ('maze' algorithm only). The requested coordinates are snapped to the
   *  border ring, so a caller that marks the gates must read them back from here. */
  mazeGates?: ResolvedMazeGates;
  /** The one walk between the gates, over the run's own carved corridors and at their own width
   *  ('maze' only). */
  mazeWalk?: MacroCoord[];
  /** Where a TEXT run landed ('stencil' with a shape read): the surface tier the glyph stands one
   *  layer above, and the three ways a covered cell can be left alone — crossing a step or a pond,
   *  reaching the edge of the ground the word stands on, or standing on the tallest layer the grid
   *  has. A caller reports them rather than letting a word arrive quietly shorter than it was typed. */
  stencil?: { base: number; offBase: number; unsupported: number; atCeiling: number };
}

/**
 * Dispatch to the appropriate generator based on config.algorithm.
 *
 * `reg` is the live rule set. Only the `designed` algorithm needs it — its own placement stage
 * commits objects through `tryPlace`, which carries the registry in its context — and it is the
 * caller's registry rather than a fresh one so a designed run is judged by exactly the rules the
 * map is otherwise edited under.
 */
export function generateTerrain(
  config: GenerateConfig,
  state: GridState,
  executeCommand: (cmd: Command) => ValidationResult,
  reg?: RuleDispatcher,
): GenerateResult {
  switch (config.algorithm) {
    case 'maze': {
      const { placed, skipped, gates, walk } = generateMaze(state, config.seed, config.maxElevation, config.corridorWidth ?? 1, config.region, executeCommand, config.mazeGates);
      return { placed, skipped, overwritten: 0, mazeGates: gates, ...(walk ? { mazeWalk: walk } : {}) };
    }
    case 'stencil': {
      // A picture the shell rasterized. Nothing here reaches for a canvas, which is what lets this
      // run in the candidate worker alongside every other kind.
      if (!config.stencilPlan) return { placed: 0, skipped: 0, overwritten: 0 };
      const { placed, skipped, base, offBase, unsupported, atCeiling } = runStencilPlan(state, config.stencilPlan, config.maxElevation, executeCommand);
      // TRIM IS PART OF THE APPROXIMATION. A stencil is quantised to whole cells, so its outline is
      // a staircase; the cut pass recovers the diagonal the letter's stroke or the picture's edge
      // had. Each corner's shape comes from the source's sub-cell coverage (`stencil-trim.ts`); a
      // stencil with no quadrant detail takes the whole-pass round mode.
      const { origin, stencil } = config.stencilPlan;
      const touched: MacroCoord[] = [];
      for (let y = 0; y < stencil.height; y++) {
        for (let x = 0; x < stencil.width; x++) {
          const c = { x: origin.x + x, y: origin.y + y };
          const t = getCell(state.cells, c.x, c.y)?.terrain;
          if (t && (t.type === TerrainType.Mountain || t.type === TerrainType.Water)) touched.push(c);
        }
      }
      if (touched.length) {
        const pick = stencilChooser(origin, stencil);
        if (pick) edgeCutTerrainWith({ gridState: state, executeCommand }, touched, pick);
        else edgeCutGeneratedTerrain({ gridState: state, executeCommand }, touched, 'round');
      }
      return {
        placed, skipped, overwritten: 0,
        ...(base !== undefined
          ? { stencil: { base, offBase: offBase ?? 0, unsupported: unsupported ?? 0, atCeiling: atCeiling ?? 0 } }
          : {}),
      };
    }
    case 'designed':
    default: {
      if (!reg) throw new Error('generateTerrain: the designed algorithm needs the rule registry');
      // The fallback matches the shelf's own default, so a recipe that names no richness gets the
      // style the interface would have offered.
      const out = generateDesigned({
        state, execute: executeCommand, reg, seed: config.seed,
        richness: config.richness ?? 0.7,
        maxElevation: config.maxElevation,
        mode: config.mode,
        region: config.region,
      });
      return { placed: out.placed, skipped: refusedTotal(out), overwritten: 0, designed: out };
    }
  }
}

/**
 * Erase the terrain in scope.
 *
 * TWO COMMANDS, BECAUSE TWO KINDS OF CELL. An erase is refused outside the buildable zone
 * (V-ZONE-01) — nothing may be built on the boundary ring, so nothing there needs erasing — but an
 * auto edge-cut writes COSMETIC Γ patches wherever the island's silhouette turns a corner, and a
 * corner of the island can sit on a boundary cell. Those patches are terrain a plain erase cannot take,
 * and left behind they survive every clear: a blank map plus a scatter of quarter blocks along the rim,
 * so the next generation starts from ground that still remembers the last one. A patch is cycled off
 * through the door it came in by, a corner edit, which the zone rule does not gate because it adds no
 * mass.
 */
export function clearAllTerrain(
  state: GridState,
  executeCommand: (cmd: Command) => ValidationResult,
  /** Restrict to these cells. Omitted = the whole map, which is what Generate does when no region
   *  is painted. Same parameter, same meaning as `clearAllObjects`. */
  region?: readonly MacroCoord[],
  /** Cells to leave standing. Same role as `clearAllObjects`'s. */
  spare?: (x: number, y: number) => boolean,
): number {
  const { width, height } = state.template;
  const cells: MacroCoord[] = [];
  const patches: MacroCoord[] = [];
  const occ = buildObjectOccupancy(state);
  const scope = region ?? (function* all() {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) yield { x, y };
  })();

  for (const { x, y } of scope) {
    const cell = getCell(state.cells, x, y);
    if (!cell?.terrain) continue;
    if (occ.has(`${x},${y}`)) continue;
    if (spare?.(x, y)) continue;
    if (isBuildableZone(cell.zone)) cells.push({ x, y });
    else if (cell.terrain.patchOnly) patches.push({ x, y });
  }

  if (cells.length === 0 && patches.length === 0) return 0;

  if (cells.length) {
    executeCommand({ type: CommandType.EraseTerrain, timestamp: Date.now(), cells });
  }
  for (const { x, y } of patches) {
    executeCommand({
      type: CommandType.TrimCorners, timestamp: Date.now(), layer: 'terrain', x, y,
      beforeCorners: getCell(state.cells, x, y)?.terrain?.corners ?? SQUARE,
      afterCorners: ['empty', 'empty', 'empty', 'empty'],
    });
  }
  return cells.length + patches.length;
}

/**
 * Remove every placed object — tiles/road surfaces AND placements (buildings,
 * trees, bridges, ramps, …). One RemoveObject command per object (snapshotted
 * first, since executing mutates state.objects). Returns the count removed.
 */
export function clearAllObjects(
  state: GridState,
  executeCommand: (cmd: Command) => ValidationResult,
  region?: readonly MacroCoord[],
  /** Objects to leave standing. Clear passes the map's own authorship here, so taking back a
   *  generation never takes a placement the person made with it. */
  spare?: (obj: PlacedObject) => boolean,
): number {
  const inRegion = region ? new Set(region.map((c) => `${c.x},${c.y}`)) : null;
  // Footprint intersection, the same membership the marquee and the agent's region lock use: an
  // object whose footprint reaches into the region blocks every terrain paint on those cells
  // (V-PLACE-BLOCK), so a region that regenerates must take it with it, wherever its anchor sits.
  const touchesRegion = (obj: PlacedObject): boolean => {
    if (!inRegion) return true;
    const r = objectRect(obj);
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
        if (inRegion.has(`${x},${y}`)) return true;
      }
    }
    return false;
  };
  let count = 0;
  for (const obj of [...state.objects.values()]) {
    if (obj.locked) continue;   // never dissolve immutable structures (the central plaza); V-LOCK-02 also guards this
    if (!touchesRegion(obj)) continue;
    if (spare?.(obj)) continue;
    const res = executeCommand(removeObjectCommand(obj));
    if (res.success) count++;
  }
  return count;
}
