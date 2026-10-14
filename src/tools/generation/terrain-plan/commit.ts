import { paintTerrainCommand } from '../../../core/model/command-build';
import { TerrainType, type Command, type MacroCoord, type PaintTerrainCommand, type ValidationResult } from '../../../core/model/types';
import type { TerrainPlan } from './types';
import { cellKey } from '../../../core/grid/rect';

/**
 * Turn a certified plan into PaintTerrain commands the CommandExecutor will accept.
 *
 * The no-floating pre-command rule (V-MTN-02/V-WTR-01) requires that painting
 * elevation N at a cell, the cell already holds elevation >= N-1. So terrain must be
 * built cumulatively bottom-up: for each layer L, paint every cell whose final elevation
 * is >= L (a final-tier-3 cell is painted at 1, then 2, then 3 — each layer supports the
 * next; the topmost paint sets its final height). Emitting one command per cell at its
 * final elevation (the naive grouping) makes every tier-2+ cell float and get rejected.
 */
export function planToCommands(plan: TerrainPlan, region: MacroCoord[] | null): PaintTerrainCommand[] {
  const inRegion = region ? new Set(region.map((c) => cellKey(c.x, c.y))) : null;
  const allowed = (x: number, y: number): boolean => !inRegion || inRegion.has(cellKey(x, y));

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
    if (cells.length) cmds.push(paintTerrainCommand(cells, type, elevation));
  };

  // Mountains: layers 1..maxTier, each carrying every cell with final tier >= L.
  for (let L = 1; L <= maxTier; L++) layer(TerrainType.Mountain, L, (i) => plan.tier[i]! >= L);
  // Water: layers 0..maxWater, each carrying every cell with water elevation >= L.
  for (let L = 0; L <= maxWater; L++) layer(TerrainType.Water, L, (i) => plan.water[i]! >= L);

  return cmds;
}

/**
 * Paint `cells` as one layer, and on refusal retry them one by one so a single illegal cell cannot
 * take the layer down with it. `onRefuse` hears each cell refused alone, by its index in `cells`.
 * Returns how many cells took the layer.
 */
export function paintLayer(
  cells: readonly MacroCoord[], type: TerrainType, elevation: number,
  execute: (cmd: Command) => ValidationResult, onRefuse?: (index: number) => void,
): number {
  if (cells.length === 0) return 0;
  if (execute(paintTerrainCommand([...cells], type, elevation)).success) return cells.length;
  let placed = 0;
  cells.forEach((cell, i) => {
    if (execute(paintTerrainCommand([cell], type, elevation)).success) placed++;
    else onRefuse?.(i);
  });
  return placed;
}

/** A mountain column to raise: its cell and the layer it should end at. */
export interface RaiseTarget { coord: MacroCoord; top: number }

/**
 * Raise mountain columns bottom-up, each to its own `top`, for targets no repair has certified.
 *
 * One `paintLayer` per layer over the columns still climbing, so every cell stands on the layer
 * below it. A column refused at a layer stops one below it (`top` is lowered in place). With `settle`
 * set, every target within one cell of a stopped column comes down to at most `settle` above it,
 * transitively: the 3x3 base rule is post-stroke, so a neighbour left climbing over the stump would
 * pass every command and be found floating only at commit, reverting the whole stroke.
 */
export function raiseBottomUp(
  targets: readonly RaiseTarget[],
  execute: (cmd: Command) => ValidationResult,
  options: { settle?: number } = {},
): { placed: number; skipped: number } {
  const { settle } = options;
  const byCell = settle === undefined ? null : new Map(targets.map((t) => [cellKey(t.coord.x, t.coord.y), t]));
  const lower = (seed: RaiseTarget): void => {
    if (!byCell || settle === undefined) return;
    const queue = [seed];
    for (let q = 0; q < queue.length; q++) {
      const { coord, top } = queue[q]!;
      const cap = top + settle;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const n = byCell.get(cellKey(coord.x + dx, coord.y + dy));
          if (n && n.top > cap) { n.top = cap; queue.push(n); }
        }
      }
    }
  };
  let placed = 0, skipped = 0;
  let live = targets.filter((t) => t.top >= 1);
  for (let e = 1; live.length > 0; e++) {
    const group = live;
    placed += paintLayer(group.map((t) => t.coord), TerrainType.Mountain, e, execute, (i) => {
      const t = group[i]!;
      skipped++;
      t.top = e - 1;
      lower(t);
    });
    live = live.filter((t) => t.top > e);
  }
  return { placed, skipped };
}
