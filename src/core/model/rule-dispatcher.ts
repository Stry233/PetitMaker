import type { Command, GridState, ValidationError } from './types';

/**
 * The minimal rule-validation surface the command executor (and the generation /
 * agent code that borrows the registry via `CommandExecutor.getRegistry()`)
 * actually depends on. It is the SUBSET of `RuleRegistry` used by callers: the
 * two-phase validators plus the introspection accessor — never `register()`.
 *
 * It lives on the PRIMITIVES FLOOR (core/model) so the command executor never
 * imports the concrete `rules/registry`; `RuleRegistry` in rules/ `implements`
 * it, which is a downward rules->core import.
 */
export interface RuleDispatcher {
  /** Run all pre-command rules whose `appliesTo` includes `cmd.type` against `state`. */
  validatePreCommand(cmd: Command, state: GridState): ValidationError[];
  /** Run all post-stroke rules against the full `state`. */
  validatePostStroke(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[];
  /** Registered rule ids + phases, for introspection (e.g. the agent system prompt). */
  getRules(): { id: string; phase: 'pre-command' | 'post-stroke' }[];
}
