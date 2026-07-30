// src/tools/generation/commit.ts
import { CommandType, TerrainType, type PaintTerrainCommand, type MacroCoord } from '../../core/model/types';
import type { TerrainPlan } from './types';

/**
 * Turn a certified plan into PaintTerrain commands the CommandExecutor will accept.
 *
 * The no-floating pre-command rule (V-MTN-02/V-WTR-01) requires that painting
 * elevation N at a cell, the cell ALREADY holds elevation >= N-1. So terrain must be
 * built CUMULATIVELY BOTTOM-UP: for each layer L, paint every cell whose FINAL elevation
 * is >= L (a final-tier-3 cell is painted at 1, then 2, then 3 — each layer supports the
 * next; the topmost paint sets its final height). Emitting one command per cell at its
 * final elevation (the naive grouping) makes every tier-2+ cell float and get rejected.
 */
export function planToCommands(plan: TerrainPlan, region: MacroCoord[] | null): PaintTerrainCommand[] {
  const inRegion = region ? new Set(region.map((c) => `${c.x},${c.y}`)) : null;
  const allowed = (x: number, y: number): boolean => !inRegion || inRegion.has(`${x},${y}`);

  let maxTier = 0, maxWater = -1;
  for (let i = 0; i < plan.tier.length; i++) {
    if (plan.tier[i]! > maxTier) maxTier = plan.tier[i]!;
    if (plan.water[i]! > maxWater) maxWater = plan.water[i]!;
  }

  const cmds: PaintTerrainCommand[] = [];
  const layer = (type: TerrainType, elevation: number, keep: (i: number) => boolean): void => {
    const cells: MacroCoord[] = [];
    for (let y = 0; y < plan.height; y++) {
      for (let x = 0; x < plan.width; x++) {
        if (!allowed(x, y)) continue;
        if (keep(y * plan.width + x)) cells.push({ x, y });
      }
    }
    if (cells.length) cmds.push({ type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType: type, elevation });
  };

  // Mountains: layers 1..maxTier, each carrying every cell with final tier >= L.
  for (let L = 1; L <= maxTier; L++) layer(TerrainType.Mountain, L, (i) => plan.tier[i]! >= L);
  // Water: layers 0..maxWater, each carrying every cell with water elevation >= L.
  for (let L = 0; L <= maxWater; L++) layer(TerrainType.Water, L, (i) => plan.water[i]! >= L);

  return cmds;
}
