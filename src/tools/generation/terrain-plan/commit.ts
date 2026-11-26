import { mountainLadder, paintTerrainCommand } from '../../../core/model/command-build';
import { TerrainType, type Command, type MacroCoord, type PaintTerrainCommand, type ValidationResult } from '../../../core/model/types';
import type { TerrainPlan } from './types';
import type { Scope } from './scope';
import { cellKey } from '../../../core/grid/rect';

/** A column to build: its cell, the first layer laid on it and the layer it ends at. */
interface Column { at: MacroCoord; from: number; top: number }

/**
 * The layers that build every column from its own `from` up to its `top`, lowest first, each layer
 * carrying every column still climbing, so each cell stands on the layer below it (V-MTN-02 and
 * V-WTR-01 by construction). Mountain climbs through `mountainLadder`; water starts at the ground's
 * own layer 0, which no mountain layer is.
 */
function columnLayers(columns: readonly Column[], type: TerrainType): PaintTerrainCommand[] {
  if (type === TerrainType.Mountain) return mountainLadder(columns, (c) => c.at, (c) => c.from - 1, (c) => c.top);
  let low = Infinity, high = -Infinity;
  for (const c of columns) { low = Math.min(low, c.from); high = Math.max(high, c.top); }
  const cmds: PaintTerrainCommand[] = [];
  for (let e = low; e <= high; e++) {
    const cells = columns.filter((c) => c.from <= e && c.top >= e).map((c) => c.at);
    if (cells.length) cmds.push(paintTerrainCommand(cells, type, e));
  }
  return cmds;
}

/**
 * Turn a certified plan into PaintTerrain commands the CommandExecutor will accept, inside `scope`
 * (the whole map when null).
 *
 * The no-floating pre-command rule (V-MTN-02/V-WTR-01) requires that painting
 * elevation N at a cell, the cell already holds elevation >= N-1. So terrain must be
 * built cumulatively bottom-up: for each layer L, paint every cell whose final elevation
 * is >= L (a final-tier-3 cell is painted at 1, then 2, then 3 — each layer supports the
 * next; the topmost paint sets its final height). Emitting one command per cell at its
 * final elevation (the naive grouping) makes every tier-2+ cell float and get rejected.
 */
export function planToCommands(plan: TerrainPlan, scope: Scope | null): PaintTerrainCommand[] {
  const mountains: Column[] = [], waters: Column[] = [];
  for (let y = 0; y < plan.height; y++) {
    for (let x = 0; x < plan.width; x++) {
      if (scope && !scope.cell(x, y)) continue;
      const i = y * plan.width + x;
      if (plan.tier[i]! >= 1) mountains.push({ at: { x, y }, from: 1, top: plan.tier[i]! });
      if (plan.water[i]! >= 0) waters.push({ at: { x, y }, from: 0, top: plan.water[i]! });
    }
  }
  return [...columnLayers(mountains, TerrainType.Mountain), ...columnLayers(waters, TerrainType.Water)];
}

/**
 * Paint `cells` as one layer, and on refusal split it in halves down to the single cells that are
 * the refusal, so one illegal cell cannot take the layer down with it. Cells within a paint are
 * judged independently (zone, bleed, support under the cell itself), so a half that stands is the
 * same map as the whole would have been. `onRefuse` hears each cell refused alone, by its index in
 * `cells`, in index order. Returns how many cells took the layer.
 */
export function paintLayer(
  cells: readonly MacroCoord[], type: TerrainType, elevation: number,
  execute: (cmd: Command) => ValidationResult, onRefuse?: (index: number) => void,
): number {
  const paint = (lo: number, hi: number): number => {
    if (execute(paintTerrainCommand(cells.slice(lo, hi), type, elevation)).success) return hi - lo;
    if (hi - lo === 1) { onRefuse?.(lo); return 0; }
    const mid = (lo + hi) >> 1;
    return paint(lo, mid) + paint(mid, hi);
  };
  return cells.length === 0 ? 0 : paint(0, cells.length);
}

/** Build `columns` of `type` layer by layer (`columnLayers`), each layer painted by `paintLayer`.
 *  Returns how many cells took a layer. */
export function buildColumns(
  columns: readonly Column[], type: TerrainType, execute: (cmd: Command) => ValidationResult,
): number {
  let placed = 0;
  for (const cmd of columnLayers(columns, type)) placed += paintLayer(cmd.cells, type, cmd.elevation, execute);
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
