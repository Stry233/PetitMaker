/**
 * The editor a macro runs against: `core/commands/edit-context.ts:EditContext` plus the off-thread
 * runners, a port its caller fills; without them every run is in-process.
 */
import type { EditContext } from '../../core/commands/edit-context';
import type { GridState } from '../../core/model/types';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import type { MacroBuild, MacroId, MacroOpts } from './run';
import type { MacroPreview } from './runtime/preview';

/**
 * Runners that build or preview a macro off this thread, supplied by the layer that owns the worker
 * pool. The asynchronous paths prefer them and fall back to the same run in-process; a runner that
 * rejects with `MacroRunnerUnavailable` is cleared from its port, any other rejection is one failed job.
 * `rules` is the asking map's registry: the runner judges the run by the same rule set.
 */
export interface MacroOffThread {
  build: ((state: GridState, id: MacroId, opts: MacroOpts, rules: RuleDispatcher) => Promise<MacroBuild | null>) | null;
  preview: ((state: GridState, id: MacroId, opts: MacroOpts, rules: RuleDispatcher) => Promise<MacroPreview>) | null;
}

export interface MacroContext extends EditContext {
  offThread?: MacroOffThread;
}

/** What a Smart Build tool reads from its host beyond the base contract: a macro context built from
 *  the same map and executor the host wraps, so a run from the map is the run the assistant makes. */
export interface MacroChannel {
  macroContext: MacroContext;
}
