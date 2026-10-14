// The contracts the generation layer shares.
import type { Command, GridState, ValidationResult } from '../../../core/model/types';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';

/** What a run builds through: the map, the executor that applies (and may refuse) each command,
 *  and the caller's live rule set, so a run is judged by exactly the rules the map is otherwise
 *  edited under. */
export interface GenerationContext {
  state: GridState;
  execute: (cmd: Command) => ValidationResult;
  reg: RuleDispatcher;
}

/** The map and its executor, for a pass that consults no rules beyond what the executor applies. */
export type MapWriter = Pick<GenerationContext, 'state' | 'execute'>;

/** The final, certified-valid terrain plan handed to commit. */
export interface TerrainPlan {
  width: number; height: number;
  tier: Int8Array;   // mountain elevation 1..maxTier, or 0 = ground (no terrain)
  water: Int8Array;  // water elevation, or -1 = none (mutually exclusive with tier>0)
}
