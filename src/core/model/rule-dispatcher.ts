import type { Command, GridState, ValidationError } from './types';

/**
 * The minimal rule-validation surface the command executor (and the generation /
 * agent code that borrows the registry via `CommandExecutor.getRegistry()`)
 * actually depends on. It is the SUBSET of `RuleRegistry` used by callers: the
 * two-phase validators plus the introspection accessor — never `register()`.
 *
 * Defining it here, on the PRIMITIVES FLOOR (core/model), lets the command
 * executor depend on this interface instead of the concrete `rules/registry`
 * implementation, removing the last core->rules dependency edge. The concrete
 * `RuleRegistry` (in rules/) structurally satisfies — and explicitly
 * `implements` — this interface; that is a rules->core import, which is allowed.
 */
export interface RuleDispatcher {
  /** Run all pre-command rules whose `appliesTo` includes `cmd.type` against `state`. */
  validatePreCommand(cmd: Command, state: GridState): ValidationError[];
  /** Run all post-stroke rules against the full `state`. */
  validatePostStroke(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[];
  /** Registered rule ids + phases, for introspection (e.g. the agent system prompt). */
  getRules(): { id: string; phase: 'pre-command' | 'post-stroke' }[];
}
