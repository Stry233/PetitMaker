/**
 * The one wiring of a job's loop: its executor with delegation, the role's prompt, tools and turn
 * budget, and the readings the loop takes from the live map. `runner.ts:launch` builds every job
 * through it, and the live campaigns in `scripts/internal/agent-eval/` run theirs through it too, so a
 * campaign measures the job the panel runs. The caller adds what only it has (the content check,
 * the live stream, a skippable sleep) to the returned object, whose `oversight` stays a live getter.
 */
import type { Adapter } from '../core/adapter';
import type { Oversight } from '../core/gates';
import { SUBAGENT_MAX_TURNS } from '../core/governor';
import type { SessionLog } from '../core/log';
import type { LoopDeps } from '../core/loop';
import { rawIsAllFrom } from '../core/project-messages';
import { districtSystemPrompt, helperSystemPrompt } from '../prompts/index';
import { wireSchemas, type AgentToolDeps } from '../tools';
import { createExecutor, type DelegateOpts } from './executor';

/** Which job runs: the lead of the user's order, a helper on one place, or a district lead. */
type JobRole = 'lead' | 'helper' | 'district';

interface JobWiring {
  toolDeps: AgentToolDeps;
  adapter: Adapter;
  model: string;
  capabilities?: LoopDeps['capabilities'];
  thinking?: LoopDeps['thinking'];
  /** The lead's system prompt; a helper's and a district lead's are made from it (`prompts/index.ts`). */
  system: string;
  /** Read at every gate decision, so a tier changed mid-job applies to the next write. */
  oversight: () => Oversight;
  signal: AbortSignal;
  log: SessionLog;
  role?: JobRole;
  maxTurns?: number;
  /** The latest operation of each running child, null once it settles. */
  onChildProgress?: DelegateOpts['onChildProgress'];
  /** The recording seam: each child's log as the child starts, `label` naming it under its parents. */
  onChildLog?: DelegateOpts['onChildLog'];
}

/** A job's loop dependencies as `wiring` describes it. */
export function jobLoopDeps(wiring: JobWiring): LoopDeps {
  const { toolDeps, adapter, model, capabilities, thinking, system, signal, log } = wiring;
  const role = wiring.role ?? 'lead';
  const delegate: DelegateOpts = {
    adapter, model, capabilities, thinking, system,
    get oversight() { return wiring.oversight(); },
    signal, log,
    ...(wiring.onChildProgress ? { onChildProgress: wiring.onChildProgress } : {}),
    ...(wiring.onChildLog ? { onChildLog: wiring.onChildLog } : {}),
  };
  // A helper briefs no one; a district lead hands out places only.
  const executor = role === 'helper' ? createExecutor(toolDeps, { subagent: true })
    : createExecutor(toolDeps, { delegate, ...(role === 'district' ? { district: true } : {}) });
  const maxTurns = wiring.maxTurns ?? (role === 'helper' ? SUBAGENT_MAX_TURNS : undefined);
  return {
    adapter, model, capabilities, thinking,
    system: role === 'helper' ? helperSystemPrompt(system) : role === 'district' ? districtSystemPrompt(system) : system,
    tools: wireSchemas(role === 'helper' ? { subagent: true } : role === 'district' ? { district: true } : undefined),
    executor,
    get oversight() { return wiring.oversight(); },
    // One log may carry turns of several models, so raw replay is decided per launch.
    sameModel: rawIsAllFrom(log, model),
    contextWindow: capabilities?.context,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    signal,
    undoStackSize: () => toolDeps.getExecutor().historyDepth(),
  };
}
