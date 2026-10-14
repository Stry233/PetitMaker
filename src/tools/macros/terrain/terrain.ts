/**
 * Laying terrain on a live map through the command executor.
 *
 * The generator's terrain machinery shapes a `TerrainPlan`, a scratch grid that becomes a map only
 * when the run commits, so none of it can be aimed at a cell of a map the user already built. These
 * are the same moves against live state: every command goes through the executor's pre-command
 * validation, and the post-stroke rules are consulted explicitly, because a terrain macro decides
 * how much of itself to keep rather than letting `commitStroke` revert the lot.
 */
import { paintTerrainCommand } from '../../../core/model/command-build';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { getCell } from '../../../core/model/grid-model';
import { isBuildableZone } from '../../../core/game/zones';
import { CommandType, TerrainType, type GridState, type MacroCoord } from '../../../core/model/types';
import type { AutoEdgeCut } from '../../../state/editing/vocabulary';
import { applyAutoEdgeCut } from '../../trim/auto-edge-cut';
import type { MacroContext } from '../context';

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

/** Terrain may be painted here at all. Sea, beach, a landmark and boundary all refuse. */
export function canBuildAt(state: GridState, x: number, y: number): boolean {
  const cell = getCell(state.cells, x, y);
  return !!cell && isBuildableZone(cell.zone);
}

/** One command, all or nothing. */
export function paint(ctx: MacroContext, cells: MacroCoord[], type: TerrainType, elevation: number): boolean {
  if (cells.length === 0) return true;
  return ctx.executor.execute(paintTerrainCommand(cells, type, elevation)).success;
}

/** Whether the whole map satisfies the post-stroke rules. A terrain macro asks before it keeps a
 *  step, which is what lets it stop building instead of having the commit throw the run away. */
export function isClean(ctx: MacroContext): boolean {
  return ctx.registry.validatePostStroke(ctx.state, { firstOnly: true }).length === 0;
}

/** Auto Trim over `cells`, refusing any trim or fillet paint that reaches a cell `editable` rejects,
 *  so a macro's edge cuts stay inside the ground it may change. */
export function trimWithin(ctx: MacroContext, trim: AutoEdgeCut, cells: MacroCoord[], editable: (c: MacroCoord) => boolean): void {
  applyAutoEdgeCut({
    state: ctx.state,
    execute: cmd => {
      const touched = cmd.type === CommandType.TrimCorners ? [{ x: cmd.x, y: cmd.y }]
        : cmd.type === CommandType.PaintTerrain ? cmd.cells : [];
      if (touched.some(c => !editable(c))) return { success: false, errors: [] };
      return ctx.executor.execute(cmd);
    },
  }, trim, cells, []);
}
