/**
 * Laying terrain on a LIVE map through the command executor.
 *
 * The generator's terrain machinery shapes a `TerrainPlan`, a scratch grid that becomes a map only
 * when the run commits, so none of it can be aimed at a cell of a map the user already built. These
 * are the same moves against live state: every command goes through the executor's pre-command
 * validation, and the post-stroke rules are consulted explicitly, because a terrain macro decides
 * how much of itself to keep rather than letting `commitStroke` revert the lot.
 */
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import { CommandType, TerrainType, type GridState, type MacroCoord } from '../../core/model/types';
import type { MacroContext } from './context';

/** Water above this cannot be capped: a cap sits at exactly the water's elevation, and a mountain at
 *  4 or more owes V-MTN-03 a 3x3 base. A taller drop has to chain units. */
export const WATER_CEILING = 3;

/** The standable surface, -1 off the grid. Raw `terrain.elevation` reads a cosmetic Γ fillet as a
 *  full block, which is a phantom rung to every question below. */
export function surfaceAt(state: GridState, x: number, y: number): number {
  const cell = getCell(state.cells, x, y);
  return cell ? surfaceElevation(cell.terrain) : -1;
}

export function isWaterAt(state: GridState, x: number, y: number, elevation?: number): boolean {
  const t = getCell(state.cells, x, y)?.terrain;
  if (!t || t.type !== TerrainType.Water) return false;
  return elevation === undefined || surfaceElevation(t) === elevation;
}

/** Terrain may be painted here at all. Sea, beach, plaza and boundary all refuse. */
export function canBuildAt(state: GridState, x: number, y: number): boolean {
  const cell = getCell(state.cells, x, y);
  return !!cell && isBuildableZone(cell.zone);
}

/** In the grid's interior: a water cell on the outermost ring has an off-map neighbour, which
 *  V-WTR-02 counts as a lower one and can never cap. */
export function isInterior(state: GridState, x: number, y: number): boolean {
  const { width, height } = state.template;
  return x > 0 && y > 0 && x < width - 1 && y < height - 1;
}

/** One command, all or nothing. */
export function paint(ctx: MacroContext, cells: MacroCoord[], type: TerrainType, elevation: number): boolean {
  if (cells.length === 0) return true;
  return ctx.executor.execute({
    type: CommandType.PaintTerrain, timestamp: Date.now(), cells, terrainType: type, elevation,
  }).success;
}

/** The same paint, retried cell by cell when the batch is refused, so one forbidden cell costs only
 *  itself. Returns how many cells took it. */
export function paintSkipping(ctx: MacroContext, cells: MacroCoord[], type: TerrainType, elevation: number): number {
  if (cells.length === 0) return 0;
  if (paint(ctx, cells, type, elevation)) return cells.length;
  let laid = 0;
  for (const c of cells) if (paint(ctx, [c], type, elevation)) laid++;
  return laid;
}

/** Make `c` dry mountain at exactly `e`, walking up a rung at a time: V-MTN-02 forbids skipping a
 *  layer, so a cell two tiers below the target needs the tier between it first. Lowering is a single
 *  paint, since the rung below the target is already there. */
export function setMountain(ctx: MacroContext, c: MacroCoord, e: number): boolean {
  const from = surfaceAt(ctx.state, c.x, c.y);
  if (e <= 0) return paint(ctx, [c], TerrainType.Mountain, 0);
  if (from === e && !isWaterAt(ctx.state, c.x, c.y)) return true;
  for (let lvl = Math.max(1, Math.min(from + 1, e)); lvl <= e; lvl++) {
    if (!paint(ctx, [c], TerrainType.Mountain, lvl)) return false;
  }
  return true;
}

/** Whether the whole map satisfies the post-stroke rules. A terrain macro asks before it keeps a
 *  step, which is what lets it stop building instead of having the commit throw the run away. */
export function isClean(ctx: MacroContext): boolean {
  return ctx.registry.validatePostStroke(ctx.state, { firstOnly: true }).length === 0;
}
