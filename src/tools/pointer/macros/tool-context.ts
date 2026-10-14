import type { MacroCoord } from '../../../core/model/types';
import { isBuildableZone } from '../../../core/game/zones';
import type { ToolContext } from '../runtime/types';
import type { MacroChannel } from '../../macros/context';
import type { CurveChannel } from '../paint/curve-session';

/** The context the Smart Build tools run with: macro runs, and curve sessions for aimed builds. */
export type MacroToolContext = ToolContext & MacroChannel & CurveChannel;

/** Whether `coord` is buildable ground, where a Smart Build press acts. */
export function onBuildableGround(coord: MacroCoord, ctx: ToolContext): boolean {
  const cell = ctx.state.cells[coord.y]?.[coord.x];
  return !!cell && isBuildableZone(cell.zone);
}
