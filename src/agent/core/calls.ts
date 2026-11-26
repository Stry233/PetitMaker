/**
 * Runs one assistant turn's tool calls in order: gates them, answers `update_plan` itself, executes
 * the rest through the tool executor, paces consecutive writes, and resumes calls a reload left
 * pending.
 */
import { askGate, awaitGate, shouldGate, shouldGatePlan } from './gates';
import { planProgress, repeatedFailure, revertCount, verbatimFailures } from './governor';
import {
  helperInterrupted, planMalformed, planProgressRefusal, planProgressResult, planRevisionLimit, planSet,
  reissueMessage, repeatRefusal, replyNoted, revertNudge, toolCrashed, verbatimRetryNudge,
} from './nudges';
import { loopNoteResult } from './tool-result';
import { append, type SessionLog } from './log';
import { PROTOCOL } from './protocol';
import { MAP_LEFT, parseStages, type JobOutcome, type Part, type ToolPart } from './types';
import { createSkippableSleeper } from './skippable-sleep';
import { gateLevelOf, writesMap } from './tool-facts';
import { type AssistantEvent, deriveBadCallIds, jobEvents, eventsAfter, existingGateId, hasAllowAlways, hasJobCheckpoint, hasPlanEvent, isCallResolved, pauseIsPending } from './job-reads';
import type { ExecutedResult, LoopDeps } from './loop';

type ReissueSignal = 'continue' | 'paused' | 'aborted';

/**
 * The hand-overs that have started, per log this session has run: a hand-over a pause held back before
 * it started runs when the job resumes, and one that had started is never run again. A log restored
 * after a reload has no entry, so every unresolved hand-over in it counts as started.
 */
const begun = new WeakMap<SessionLog, Set<string>>();

export function isToolPart(p: Part): p is ToolPart { return p.kind === 'tool'; }

/** Grants a pending pause request at a loop boundary; true when the job is now held. */
export function parkIfPausePending(log: SessionLog): boolean {
  if (!pauseIsPending(log)) return false;
  append(log, { kind: 'paused' });
  return true;
}

/** Records an undo watermark for each stage the plan has entered. */
export function syncStageCheckpoints(log: SessionLog, deps: LoopDeps): void {
  if (!hasPlanEvent(log)) return;
  const stageCount = planProgress(log)?.stageCount ?? 0;
  const events = jobEvents(log);
  const done = new Set<number>();
  for (const e of events) {
    if (e.kind === 'checkpoint' && e.stageIndex !== undefined) done.add(e.stageIndex);
  }
  for (const e of events) {
    if (e.kind === 'stage' && e.index < stageCount && !done.has(e.index)) {
      append(log, { kind: 'checkpoint', undoIndex: deps.undoStackSize(), label: 'stage', stageIndex: e.index });
      done.add(e.index);
    }
  }
}

/** Appends a `stage` event; the loop picks it up as a checkpoint at the next step boundary. */
function advanceStage(log: SessionLog, index: number): void {
  append(log, { kind: 'stage', index });
}

/** Settles a job and records the upper undo boundary used by its take-back action. */
export function endJob(
  log: SessionLog,
  deps: LoopDeps,
  end: { outcome: JobOutcome; summary?: string; question?: true },
): void {
  const cause = end.outcome === 'aborted' && deps.signal.reason === MAP_LEFT ? { stoppedBy: MAP_LEFT } : null;
  append(log, { kind: 'jobEnd', ...end, ...cause, undoIndex: deps.undoStackSize() });
}

/** The wait a job takes when its deps bring no sleep of their own: a sleeper nothing skips. */
export const realSleep = createSkippableSleeper().sleep;

/** Asks, or finds this occurrence's persisted question, and waits for the answer: whether it allows. */
async function askAndWait(
  log: SessionLog, deps: LoopDeps, scope: 'tool' | 'plan', part: ToolPart, assistantSeq: number,
): Promise<boolean | 'aborted'> {
  const gateId = existingGateId(log, scope, part.callId, assistantSeq)
    ?? askGate(log, {
      scope, callId: part.callId, turnSeq: assistantSeq,
      summary: deps.executor.describe({ name: part.name, args: part.input }),
    });
  try {
    const { answer } = await awaitGate(log, gateId, deps.signal);
    return answer === 'allow' || answer === 'allow-always';
  } catch {
    return 'aborted';
  }
}

/** Resolves a call's supervision gate. */
async function resolveGate(log: SessionLog, deps: LoopDeps, part: ToolPart, assistantSeq: number): Promise<boolean | 'aborted'> {
  const level = gateLevelOf(deps.executor.facts, part.name, part.input);
  const gate = shouldGate({
    isWrite: level !== 'none', isWide: level === 'wide',
    oversight: deps.oversight, allowAll: hasAllowAlways(log),
  });
  return gate ? askAndWait(log, deps, 'tool', part, assistantSeq) : true;
}

/** Stamps whether a result writes and which assistant turn emitted its call. */
function resultStamp(deps: LoopDeps, name: string, assistantSeq: number): { write: boolean; turnSeq: number } {
  return { write: writesMap(deps.executor.facts, name), turnSeq: assistantSeq };
}

/** A job may file its initial plan and one revision. */
const MAX_PLAN_FILINGS = 2;

async function handleUpdatePlan(log: SessionLog, deps: LoopDeps, part: ToolPart, assistantSeq: number): Promise<ReissueSignal> {
  if ('completedStages' in part.input) {
    const plan = planProgress(log);
    const completed = part.input.completedStages;
    const valid = plan !== undefined && part.input.stages === undefined
      && typeof completed === 'number' && Number.isInteger(completed)
      && completed >= plan.current && completed <= plan.stageCount;
    if (valid && completed > plan.current) advanceStage(log, completed);
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, isError: !valid,
      content: valid ? planProgressResult(completed, plan.stageCount) : planProgressRefusal(),
      ...resultStamp(deps, part.name, assistantSeq),
    });
    return 'continue';
  }
  const stages = parseStages(part.input.stages);
  if (!stages) {
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, ...loopNoteResult(planMalformed()),
      ...resultStamp(deps, part.name, assistantSeq),
    });
    return 'continue';
  }
  // Reject excess revisions before supervision because the plan cannot be accepted.
  if (jobEvents(log).filter((e) => e.kind === 'plan').length >= MAX_PLAN_FILINGS) {
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, ...loopNoteResult(planRevisionLimit(), { damper: true }),
      ...resultStamp(deps, part.name, assistantSeq),
    });
    return 'continue';
  }

  const needsGate = shouldGatePlan({ oversight: deps.oversight, allowAll: hasAllowAlways(log) });
  const approved = needsGate ? await askAndWait(log, deps, 'plan', part, assistantSeq) : true;
  if (approved === 'aborted') return 'aborted';
  if (approved) {
    const revision = jobEvents(log).filter((e) => e.kind === 'plan').length + 1;
    append(log, { kind: 'plan', stages, revision });
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, content: planSet(stages.length, deps.executor.facts.guides), isError: false,
      ...resultStamp(deps, part.name, assistantSeq),
    });
  }
  // Skip and typed answers are projected from their gate events without a tool result.
  return 'continue';
}

/**
 * Processes one assistant turn's calls in order. Persisted results make the operation resumable;
 * `assistantSeq` scopes reused call IDs, and `toolNames` limits loop-owned pseudo-tools to the
 * advertised schema. Interrupted delegated helpers are not replayed.
 */
export async function processCalls(
  log: SessionLog, deps: LoopDeps, toolParts: readonly ToolPart[],
  turn: { badCallIds: ReadonlySet<string>; assistantSeq: number; toolNames: ReadonlySet<string> }, resuming = false,
): Promise<ReissueSignal> {
  const { badCallIds, assistantSeq, toolNames } = turn;
  const sleep = deps.sleep ?? realSleep;
  /** Whether this batch has executed a write, whatever its result, so the next write waits a beat. */
  let built = false;
  if (!resuming && !begun.has(log)) begun.set(log, new Set());

  /** Everything that stands before a call runs: 'run' to execute it, 'skip' when it is already answered. */
  const admit = async (part: ToolPart): Promise<'run' | 'skip' | 'paused' | 'aborted'> => {
    if (isCallResolved(eventsAfter(log, assistantSeq), part.callId)) return 'skip';
    if (deps.signal.aborted) return 'aborted';
    if (parkIfPausePending(log)) return 'paused';

    if (badCallIds.has(part.callId)) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, ...loopNoteResult(reissueMessage()),
        ...resultStamp(deps, part.name, assistantSeq),
      });
      return 'skip';
    }
    if (part.name === PROTOCOL.reply && toolNames.has(part.name)) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, content: replyNoted(), isError: false,
        ...resultStamp(deps, part.name, assistantSeq),
      });
      return 'skip';
    }
    if (part.name === PROTOCOL.plan && toolNames.has(part.name)) {
      const outcome = await handleUpdatePlan(log, deps, part, assistantSeq);
      return outcome === 'continue' ? 'skip' : outcome;
    }

    // A delegated helper that had started may have partially edited the map without a resumable child log.
    if (resuming && part.name === PROTOCOL.delegate && begun.get(log)?.has(part.callId) !== false) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, ...loopNoteResult(helperInterrupted()),
        ...resultStamp(deps, part.name, assistantSeq),
      });
      return 'skip';
    }

    // Reuse an identical failure until a success or map write changes its basis.
    const streak = repeatedFailure(log, { name: part.name, args: part.input });
    if (streak) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name,
        ...loopNoteResult(repeatRefusal(deps.executor.facts.guides, streak), { damper: true, repeatRefused: true }),
        ...resultStamp(deps, part.name, assistantSeq),
      });
      return 'skip';
    }

    const proceed = await resolveGate(log, deps, part, assistantSeq);
    if (proceed === 'aborted') return 'aborted';
    if (deps.signal.aborted) return 'aborted';
    if (parkIfPausePending(log)) return 'paused';
    if (!proceed) return 'skip'; // skipped: the projection synthesizes the model-visible result

    const isWrite = writesMap(deps.executor.facts, part.name);
    if (isWrite && !hasJobCheckpoint(log)) {
      append(log, { kind: 'checkpoint', undoIndex: deps.undoStackSize(), label: 'job' });
    }

    // Pace consecutive writes and let the job signal interrupt the wait. A hand-over is not an edit to watch land.
    if (isWrite && built && part.name !== PROTOCOL.delegate) {
      try {
        await sleep(BUILD_BEAT_MS, deps.signal);
      } catch {
        return 'aborted';
      }
    }

    if (deps.signal.aborted) return 'aborted';
    if (parkIfPausePending(log)) return 'paused';
    return 'run';
  };

  const run = async (part: ToolPart): Promise<ExecutedResult> => {
    if (part.name === PROTOCOL.delegate) begun.get(log)?.add(part.callId);
    try {
      const executed = await deps.executor.execute({ callId: part.callId, name: part.name, args: part.input });
      if (writesMap(deps.executor.facts, part.name)) built = true;
      return executed;
    } catch (err) {
      return loopNoteResult(toolCrashed(err));
    }
  };

  const file = (part: ToolPart, executed: ExecutedResult): void => {
    let content = executed.content;
    let dampered = false;
    if (executed.isError) {
      const nudge = verbatimRetryNudge(deps.executor.facts.guides, verbatimFailures(log, { name: part.name, args: part.input }));
      if (nudge) { content = `${content}\n\n${nudge}`; dampered = true; }
    }
    if (executed.detail?.reverted) {
      const nudge = revertNudge(deps.executor.facts.guides, part.name, revertCount(log, part.name));
      if (nudge) { content = `${content}\n\n${nudge}`; dampered = true; }
    }
    const detail = dampered ? { ...(executed.detail ?? {}), damper: true as const } : executed.detail;
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, content, isError: executed.isError,
      ...(executed.image !== undefined ? { image: executed.image } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...resultStamp(deps, part.name, assistantSeq),
    });
  };

  for (let i = 0; i < toolParts.length; i++) {
    const part = toolParts[i]!;
    const first = await admit(part);
    if (first === 'aborted' || first === 'paused') return first;
    if (first === 'skip') continue;
    // Helpers briefed side by side in one turn work at the same time; their results are filed in the order asked.
    const batch = [part];
    let held: 'paused' | 'aborted' | undefined;
    while (part.name === PROTOCOL.delegate && toolParts[i + 1]?.name === PROTOCOL.delegate) {
      const next = toolParts[++i]!;
      const ready = await admit(next);
      if (ready === 'run') batch.push(next);
      else if (ready !== 'skip') { held = ready; break; }
    }
    // A pause or a stop that arrives while the batch is admitted starts none of it.
    if (held) return held;
    const results = await Promise.all(batch.map(run));
    batch.forEach((p, k) => file(p, results[k]!));
  }
  return 'continue';
}

/** Delay in milliseconds between writes in one tool-call batch, allowing each map change to render. */
const BUILD_BEAT_MS = 420;

/** Resumes any calls left over from an interrupted previous `runJob` (a pause, an abort, or a
 *  reload): the latest assistant turn's calls that have neither a result nor a settled gate. */
export async function resumeLeftoverCalls(
  log: SessionLog, deps: LoopDeps, toolNames: ReadonlySet<string>,
): Promise<JobOutcome | 'paused' | undefined> {
  const events = jobEvents(log);
  let latest: AssistantEvent | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'assistant') { latest = e; break; }
    if (e?.kind === 'jobEnd' || e?.kind === 'incident') return undefined;
  }
  if (!latest || latest.stop === 'aborted' || latest.stop === 'error') return undefined;
  const assistantSeq = latest.seq;
  const toolParts = latest.parts.filter(isToolPart);
  if (toolParts.length === 0) return undefined;
  if (toolParts.every((p) => isCallResolved(eventsAfter(log, assistantSeq), p.callId))) return undefined;

  const outcome = await processCalls(log, deps, toolParts, { badCallIds: deriveBadCallIds(latest), assistantSeq, toolNames }, true);
  if (outcome === 'paused') return 'paused';
  if (outcome === 'aborted') { endJob(log, deps, { outcome: 'aborted' }); return 'aborted'; }
  return undefined; // resolved; fall through to the main loop for the job's next turn
}
