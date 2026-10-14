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
import { append, type SessionLog } from './log';
import { PROTOCOL } from './protocol';
import { parseStages, type JobOutcome, type Part, type ToolPart } from './types';
import { createSkippableSleeper } from './skippable-sleep';
import { writesMap } from './tool-facts';
import { type AssistantEvent, deriveBadCallIds, jobEvents, eventsAfter, existingGateId, hasAllowAlways, hasJobCheckpoint, hasPlanEvent, isCallResolved, pauseIsPending } from './job-reads';
import type { ExecutedResult, LoopDeps } from './loop';

type ReissueSignal = 'continue' | 'paused' | 'aborted';

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
  append(log, { kind: 'jobEnd', ...end, undoIndex: deps.undoStackSize() });
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
  const gate = shouldGate({
    isWrite: writesMap(deps.executor.facts, part.name), isWide: deps.executor.facts.access(part.name) === 'wide',
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
      kind: 'toolResult', callId: part.callId, name: part.name, isError: true,
      content: planMalformed(),
      ...resultStamp(deps, part.name, assistantSeq),
    });
    return 'continue';
  }
  // Reject excess revisions before supervision because the plan cannot be accepted.
  if (jobEvents(log).filter((e) => e.kind === 'plan').length >= MAX_PLAN_FILINGS) {
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, isError: true,
      detail: { damper: true },
      content: planRevisionLimit(),
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
      kind: 'toolResult', callId: part.callId, name: part.name, content: planSet(), isError: false,
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
  for (const part of toolParts) {
    if (isCallResolved(eventsAfter(log, assistantSeq), part.callId)) continue;
    if (deps.signal.aborted) return 'aborted';
    if (parkIfPausePending(log)) return 'paused';

    if (badCallIds.has(part.callId)) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, content: reissueMessage(), isError: true,
        ...resultStamp(deps, part.name, assistantSeq),
      });
      continue;
    }
    if (part.name === PROTOCOL.reply && toolNames.has(part.name)) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, content: replyNoted(), isError: false,
        ...resultStamp(deps, part.name, assistantSeq),
      });
      continue;
    }
    if (part.name === PROTOCOL.plan && toolNames.has(part.name)) {
      const outcome = await handleUpdatePlan(log, deps, part, assistantSeq);
      if (outcome !== 'continue') return outcome;
      continue;
    }

    // A delegated helper may have partially edited the map without a resumable child log.
    if (resuming && part.name === PROTOCOL.delegate) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, isError: true,
        content: helperInterrupted(),
        ...resultStamp(deps, part.name, assistantSeq),
      });
      continue;
    }

    // Reuse an identical failure until a success or map write changes its basis.
    const streak = repeatedFailure(log, { name: part.name, args: part.input });
    if (streak) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, isError: true,
        content: repeatRefusal(deps.executor.facts.guides, streak),
        detail: { damper: true, repeatRefused: true },
        ...resultStamp(deps, part.name, assistantSeq),
      });
      continue;
    }

    const proceed = await resolveGate(log, deps, part, assistantSeq);
    if (proceed === 'aborted') return 'aborted';
    if (deps.signal.aborted) return 'aborted';
    if (parkIfPausePending(log)) return 'paused';
    if (!proceed) continue; // skipped: the projection synthesizes the model-visible result

    const isWrite = writesMap(deps.executor.facts, part.name);
    if (isWrite && !hasJobCheckpoint(log)) {
      append(log, { kind: 'checkpoint', undoIndex: deps.undoStackSize(), label: 'job' });
    }

    // Pace consecutive writes and let the job signal interrupt the wait.
    if (isWrite && built) {
      try {
        await sleep(BUILD_BEAT_MS, deps.signal);
      } catch {
        return 'aborted';
      }
    }

    if (deps.signal.aborted) return 'aborted';
    if (parkIfPausePending(log)) return 'paused';
    let executed: ExecutedResult;
    try {
      executed = await deps.executor.execute({ callId: part.callId, name: part.name, args: part.input });
      if (isWrite) built = true;
    } catch (err) {
      executed = { content: toolCrashed(err), isError: true };
    }
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
