import { CommandType, TerrainType } from '../../core/model/types';
import type { Command, Corners, GridState, MacroCoord, PlacedObject, ResolvedMazeGates, ValidationResult } from '../../core/model/types';
import { runLandform, toGenConfig } from './index';
import type { ZonePlan } from './types';
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import { buildObjectOccupancy, objectRect } from '../../state/object-geometry';
import { generateMaze } from './maze-generator';
import { runStencilPlan } from './stencil-generator';
import { edgeCutGeneratedTerrain, edgeCutTerrainWith } from '../edge-cut/auto-edge-cut';
import { stencilChooser } from './stencil-trim';
import { generationCutMode } from './style';
import type { GenerateConfig } from '../../core/model/types';
import { removeObjectCommand } from '../objects/object-placer';

const SQUARE: Corners = ['square', 'square', 'square', 'square'];

export interface GenerateResult {
  placed: number;
  skipped: number;
  overwritten: number;
  /** The designed-island plan ('random' algorithm only) — populate() decorates per zone theme. */
  zonePlan?: ZonePlan;
  /** Where the maze opened ('maze' algorithm only). The requested coordinates are snapped to the
   *  border ring, so a caller that marks the gates must read them back from here. */
  mazeGates?: ResolvedMazeGates;
  /** The one walk between the gates, over the run's own carved corridors ('maze' only). */
  mazeWalk?: MacroCoord[];
}

/**
 * Dispatch to the appropriate generator based on config.algorithm.
 */
export function generateTerrain(
  config: GenerateConfig,
  state: GridState,
  executeCommand: (cmd: Command) => ValidationResult,
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
      const { placed, skipped } = runStencilPlan(state, config.stencilPlan, config.maxElevation, executeCommand);
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
      return { placed, skipped, overwritten: 0 };
    }
    case 'random':
    default: {
      const gen = toGenConfig(config);
      const result = runLandform(gen, state, executeCommand);
      // Soften the generated terrain's jagged bits: round only the convex tips/steps (interiors + straight
      // edges stay square), so cliffs/coastlines read less blocky without everything being rounded.
      // The cut style comes from the shared naturalness mapping ('off' in the rectilinear style —
      // cuts are the only true diagonals); the populator cuts its roads with the same mode.
      const inRegion = config.region && config.region.length ? new Set(config.region.map((c) => `${c.x},${c.y}`)) : null;
      const cells: MacroCoord[] = [];
      for (let y = 0; y < state.template.height; y++) for (let x = 0; x < state.template.width; x++) {
        const t = getCell(state.cells, x, y)?.terrain;
        if (t && (t.type === TerrainType.Mountain || t.type === TerrainType.Water) && (!inRegion || inRegion.has(`${x},${y}`))) cells.push({ x, y });
      }
      edgeCutGeneratedTerrain({ gridState: state, executeCommand }, cells, generationCutMode(gen.seed, gen.naturalness));
      return { placed: result.placed, zonePlan: result.zonePlan, skipped: 0, overwritten: 0 };
    }
  }
}

/**
 * Erase the terrain in scope.
 *
 * TWO COMMANDS, BECAUSE TWO KINDS OF CELL. An erase is refused outside the buildable zone
 * (V-ZONE-01) — nothing may be built on the boundary ring, so nothing there needs erasing — but an
 * auto edge-cut writes COSMETIC Γ patches wherever the island's silhouette turns a corner, and a
 * corner of the island can sit on a boundary cell. Those patches are terrain the erase cannot take,
 * so they used to survive every clear: a generated map cleared to a blank map plus a scatter of
 * quarter blocks along the rim, and the next generation started from ground that still remembered
 * the last one. A patch is cycled off through the door it came in by, a corner edit, which the zone
 * rule does not gate because it adds no mass.
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
