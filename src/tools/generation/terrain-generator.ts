import { CommandType, TerrainType } from '../../core/model/types';
import type { Command, GridState, MacroCoord, RemoveObjectCommand, ValidationResult } from '../../core/model/types';
import { runLandform, toGenConfig } from './index';
import type { ZonePlan } from './types';
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import { buildObjectOccupancy } from '../../state/object-geometry';
import { generateMaze } from './maze-generator';
import { edgeCutGeneratedTerrain } from '../edge-cut/auto-edge-cut';
import { generationCutMode } from './style';
import type { GenerateConfig } from '../../core/model/types';

export interface GenerateResult {
  placed: number;
  skipped: number;
  overwritten: number;
  /** The designed-island plan ('random' algorithm only) — populate() decorates per zone theme. */
  zonePlan?: ZonePlan;
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
      const result = generateMaze(state, config.seed, config.maxElevation, config.corridorWidth ?? 1, config.region, executeCommand);
      return { ...result, overwritten: 0 };
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

export function clearAllTerrain(
  state: GridState,
  executeCommand: (cmd: Command) => ValidationResult,
): number {
  const { width, height } = state.template;
  const cells: MacroCoord[] = [];
  const occ = buildObjectOccupancy(state);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = getCell(state.cells, x, y);
      if (!cell?.terrain) continue;
      if (!isBuildableZone(cell.zone)) continue;
      if (occ.has(`${x},${y}`)) continue;
      cells.push({ x, y });
    }
  }

  if (cells.length === 0) return 0;

  const cmd: Command = {
    type: CommandType.EraseTerrain,
    timestamp: Date.now(),
    cells,
  };

  executeCommand(cmd);
  return cells.length;
}

/**
 * Remove every placed object — tiles/road surfaces AND placements (buildings,
 * trees, bridges, ramps, …). One RemoveObject command per object (snapshotted
 * first, since executing mutates state.objects). Returns the count removed.
 */
export function clearAllObjects(
  state: GridState,
  executeCommand: (cmd: Command) => ValidationResult,
  region?: MacroCoord[],
): number {
  const inRegion = region ? new Set(region.map((c) => `${c.x},${c.y}`)) : null;
  let count = 0;
  for (const obj of [...state.objects.values()]) {
    if (obj.locked) continue;   // never dissolve immutable structures (the central plaza); V-LOCK-02 also guards this
    if (inRegion && !inRegion.has(`${obj.position.x},${obj.position.y}`)) continue;
    const res = executeCommand({
      type: CommandType.RemoveObject,
      timestamp: Date.now(),
      objectId: obj.id,
      removedObject: obj,
    } as RemoveObjectCommand);
    if (res.success) count++;
  }
  return count;
}
