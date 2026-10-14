/** The command kernel with no game policy: validate, apply, record and revert only. */
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { ProvenanceRecorder } from '../../core/commands/provenance-recorder';
import type { KernelEvents } from '../../core/commands/events';
import type { StrokePolicy } from '../../core/model/stroke-policy';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import type { GridState } from '../../core/model/types';
import { RuleRegistry } from '../../rules/registry';
import { applyTrim } from '../../core/domain/edge-cut/trim-apply';

/** A policy that adds nothing: the kernel's own validate, apply, record and revert. */
export const NO_STROKE_POLICY: StrokePolicy = Object.freeze({});

/** An executor over `state` with `policy` (none by default) and `rules` (none by default). */
export function bareExecutor(
  state: GridState, opts: { rules?: RuleDispatcher; policy?: StrokePolicy; bus?: EventBus<KernelEvents> } = {},
): CommandExecutor {
  return new CommandExecutor(state, {
    bus: opts.bus ?? new EventBus<KernelEvents>(),
    rules: opts.rules ?? new RuleRegistry(),
    policy: opts.policy ?? NO_STROKE_POLICY,
    provenance: new ProvenanceRecorder(state),
    trims: applyTrim,
  });
}
