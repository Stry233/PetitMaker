import type { Command, GridState, ValidationResult } from './types';

/** The map and the one door its commands land through, for code that only executes: the cut
 *  repairs, the corner-cut passes, placement and a tool's restore. */
export interface CommandSink {
  readonly state: GridState;
  execute(cmd: Command): ValidationResult;
}
