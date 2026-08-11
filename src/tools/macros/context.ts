/**
 * The editor a macro runs against: the map, its executor, and the rules to ask.
 *
 * A macro takes it as an argument rather than reaching for the store, so it has three
 * interchangeable callers: the shell's tool, the agent's director tools, and a test's by-hand
 * triple. `kit/context.ts:KitContext` is this same shape under the name the operations layer uses.
 */
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { GridState } from '../../core/model/types';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';

export interface MacroContext {
  state: GridState;
  executor: CommandExecutor;
  /** `RuleDispatcher`, not `RuleRegistry`: a macro validates, it never registers a rule. */
  registry: RuleDispatcher;
}
