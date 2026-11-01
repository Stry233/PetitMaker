import type { MacroCoord } from '../../../core/model/types';
import { isBuildableZone } from '../../../core/game/zones';
import type { ToolContext } from '../runtime/types';
import type { MacroChannel } from '../../macros/context';
import type { CurveChannel } from '../paint/curve-session';
import type { HoldClock } from './hold-clock';

/** What a Smart Build press reads from its host beyond the macro runs: the clock its hold bursts
 *  tick on, and the seeds the host deals, if any. */
export interface MacroPressChannel {
  holdClock: HoldClock;
  /** A seed the host deals for the tool's sequence to continue from, taken once at the tool's next
   *  pointer call; null or absent keeps the tool's own sequence. */
  dealSeed?: () => number | null;
}

/** The context the Smart Build tools run with: macro runs, press timing and seeds, and curve
 *  sessions for aimed builds. */
export type MacroToolContext = ToolContext & MacroChannel & MacroPressChannel & CurveChannel;

/** Whether `coord` is buildable ground, where a Smart Build press acts. */
export function onBuildableGround(coord: MacroCoord, ctx: ToolContext): boolean {
  const cell = ctx.state.cells[coord.y]?.[coord.x];
  return !!cell && isBuildableZone(cell.zone);
}
