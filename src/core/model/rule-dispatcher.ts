import type { Command, GridState, StrokeScope, ValidationError } from './types';

/**
 * The rule-validation surface the command executor, and any caller that borrows the registry through
 * `CommandExecutor.getRegistry()`, depends on: the two-phase validators and the introspection
 * accessor, never `register()`. It is declared in `core/model` so the executor never imports
 * `rules/registry`, whose `RuleRegistry` implements it.
 */
export interface RuleDispatcher {
  /** `cmd` as it lands on `state`: each applicable pre-command rule's resolve step in order (a
   *  bridge or ramp snapped onto its span). Returns `cmd` itself when nothing changes, a copy
   *  otherwise, and resolves a resolved command to itself. */
  resolve<C extends Command>(cmd: C, state: GridState): C;
  /** Run all pre-command rules whose `appliesTo` includes `cmd.type` against `cmd` as it lands
   *  (`resolve`), within `scope` when the judgement belongs to an open stroke or a probe. Pure:
   *  neither `cmd` nor `state` changes. */
  validatePreCommand(cmd: Command, state: GridState, scope?: StrokeScope): ValidationError[];
  /** Run all post-stroke rules against the full `state`. */
  validatePostStroke(state: GridState, opts?: { firstOnly?: boolean }): ValidationError[];
  /** Registered rule ids and phases, for introspection. */
  getRules(): { id: string; phase: 'pre-command' | 'post-stroke' }[];
}
