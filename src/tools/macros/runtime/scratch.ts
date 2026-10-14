/**
 * Designed machinery over a copy of the map, and the copy's work put back on the real one. A macro
 * tries a design and keeps it only if the rules accept it; doing that on the live map leaves a
 * half-built hill when something interrupts. So it runs on a detached clone with its own executor
 * and the live rule dispatcher, returning the commands the clone accepted for replay through the
 * real executor inside the caller's stroke group. It shares `mapFingerprint` with
 * `tools/generation/run/candidates.ts:generateCandidate`.
 *
 * The clone is the whole map: one cut to the macro's radius would re-decide rules at its rim
 * (V-MTN-03's 3x3, an edge cut's eight neighbours), and cloning even the largest map costs about a
 * millisecond against a run of tens.
 */
import { cloneGridState } from '../../../core/model/grid-model';
import type { Command, GridState } from '../../../core/model/types';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { createExecutor } from '../../../state/executor';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import type { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../state/editing/events';
import type { MacroContext } from '../context';

/** A run that has already happened somewhere else. */
export interface ScratchRun {
  /** The commands the copy's executor accepted, oldest first, each as it landed: a resolved
   *  command resolves to itself, so replayed on the same base it lands the same way. */
  commands: Command[];
  /** `mapFingerprint` of the map they were built on. */
  base: string;
}

/** An editor over `state` that reaches nothing live: its own executor, `registry` for the rules, and
 *  `bus` when the caller listens to its events (none is heard otherwise). `state` is the caller's
 *  copy; nothing here clones it. */
export function detachedContext(state: GridState, registry: RuleDispatcher, bus?: EventBus<EditorEvents>): MacroContext {
  return { state, executor: createExecutor(state, registry, bus), registry };
}

/** Runs `build` against a copy of the live map and hands back what it built. The live map is not
 *  touched, and neither is its undo stack, its event bus or its provenance ledger. The build never
 *  commits, so the copy's history holds each command it kept, a rolled-back step already gone. */
export function runOnScratch(ctx: MacroContext, build: (scratch: MacroContext) => void): ScratchRun {
  const base = mapFingerprint(ctx.state);
  const scratch = detachedContext(cloneGridState(ctx.state), ctx.registry);
  build(scratch);
  return { commands: scratch.executor.getUndoEntries().map((entry) => entry.cmd), base };
}
