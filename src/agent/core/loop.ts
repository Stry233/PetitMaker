/**
 * The resumable turn loop. Durable state comes from the event log; only the currently streaming
 * turn has transient state. Gates, pending calls, counters, checkpoints and plans survive reloads.
 */
import type { Adapter, AdapterRequest } from '../providers/types';
import { redactSecrets } from '../security/redact';
import { createAssembler, type AssembledTurn } from './assembler';
import { compact, needsCompaction, COMPACTION_RESERVE } from './compaction';
import { isRetryable } from './errors';
import { askGate, awaitGate, shouldGate, type Oversight } from './gates';
import {
  budgetWarning, capMessage, consecutiveLengthStops, deliveryNudge, emptyTurnNudge, hasLandedWrite,
  jobEvents, landedWriteCount, lengthStopNudge, planOwedNudge, reasoningOnlyNudge, repeatedFailure,
  repeatRefusal, revertNudge, reviewNudge, unfinishedPlanNudge, verbatimRetryNudge,
  MAX_TURNS_DEFAULT, REVIEW_MIN_TURNS_LEFT, REVIEW_MIN_WRITES,
} from './governor';
import { append, eventsOf, type SessionLog } from './log';
import { deriveMessages } from './project-messages';
import { pacingFloorMs, retryDelayMs, MAX_TURN_RETRIES } from './retry';
import { deliverSteers } from './steering';
import { withIdleTimeout } from './stream-idle';
import { parseStages, thoughtSize } from './types';
import type {
  GateAnswer, JobOutcome, Part, SessionEvent, ToolPart, ToolResultDetail,
} from './types';

export interface ExecutedResult { content: string; isError: boolean; image?: string; detail?: ToolResultDetail }
export interface ToolExecutor {
  /** The loop converts thrown errors into redacted tool results. */
  execute(call: { callId: string; name: string; args: Record<string, unknown> }): Promise<ExecutedResult>;
  isWrite(name: string): boolean;
  isWide(name: string): boolean;
  describe(call: { name: string; args: Record<string, unknown> }): string; // the gate's human sentence
}
export interface LoopDeps {
  adapter: Adapter; model: string; system: string;
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
  executor: ToolExecutor;
  oversight: Oversight;
  sameModel: boolean;
  budgetTokens: number; estimate?: (s: string) => number;
  maxTurns?: number;
  signal: AbortSignal;
  undoStackSize: () => number;
  onLive?: (parts: readonly Part[] | null) => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>; // injected for fake-timer tests
  contextWindow?: number; // default 128000
}

type AssistantEvent = Extract<SessionEvent, { kind: 'assistant' }>;
type ReissueSignal = 'continue' | 'paused' | 'aborted';

const REISSUE_MESSAGE = '(system) The turn was cut off before the arguments were complete. '
  + 'Reissue the calls with complete arguments.';
const defaultEstimate = (s: string): number => Math.ceil(s.length / 4);

/** Recognizes halfwidth and fullwidth question endings. */
const QUESTION_END = /[?？]\s*$/;

function isToolPart(p: Part): p is ToolPart { return p.kind === 'tool'; }

/** Events after the assistant turn that emitted a particular tool-call occurrence. */
function eventsAfter(log: SessionLog, sinceSeq: number): readonly SessionEvent[] {
  return eventsOf(log).filter((e) => e.seq > sinceSeq);
}

/** A pause remains pending until the loop records `paused` or the job records `resumed`. */
function pauseIsPending(log: SessionLog): boolean {
  const events = jobEvents(log);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'pauseRequested') return true;
    if (e?.kind === 'resumed' || e?.kind === 'paused') return false;
  }
  return false;
}

function hasPlanEvent(log: SessionLog): boolean {
  return jobEvents(log).some((e) => e.kind === 'plan');
}

/** `allow-always` applies to the session rather than one job. */
function hasAllowAlways(log: SessionLog): boolean {
  return eventsOf(log).some((e) => e.kind === 'gateAnswered' && e.answer === 'allow-always');
}

function hasJobCheckpoint(log: SessionLog): boolean {
  return jobEvents(log).some((e) => e.kind === 'checkpoint' && e.label === 'job');
}

/** The undo-stack size recorded when the current job's first write ran; `0` before any write. */
export function jobUndoFloor(log: SessionLog): number {
  for (const e of jobEvents(log)) if (e.kind === 'checkpoint' && e.label === 'job') return e.undoIndex;
  return 0;
}

function countAssistantTurns(log: SessionLog): number {
  return jobEvents(log).filter((e) => e.kind === 'assistant').length;
}

/**
 * Counts trailing turns that produced neither text nor tool calls. Reasoning-only silence receives
 * a distinct nudge. Length stops break this streak and are handled by their own counter.
 */
function silentTurnState(log: SessionLog): { n: number; reasoningOnly: boolean } {
  const assistants = jobEvents(log).filter((e): e is AssistantEvent => e.kind === 'assistant');
  let n = 0;
  let reasoningOnly = false;
  for (let i = assistants.length - 1; i >= 0; i--) {
    const ev = assistants[i];
    if (!ev || ev.stop === 'length') break;
    const hasTool = ev.parts.some((p) => p.kind === 'tool');
    const text = ev.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('').trim();
    if (hasTool || text.length > 0) break;
    // Use the same non-empty reasoning measure as the panel projection.
    if (n === 0) reasoningOnly = ev.parts.some((p) => p.kind === 'reasoning' && thoughtSize(p) > 0);
    n++;
  }
  return { n, reasoningOnly };
}

/** Reconstructs incomplete or unparseable tool calls from a persisted assistant event. */
function deriveBadCallIds(ev: AssistantEvent): Set<string> {
  const ids = new Set<string>();
  for (const p of ev.parts) {
    if (p.kind === 'tool' && (ev.stop === 'length' || p.rawInput !== undefined)) ids.add(p.callId);
  }
  return ids;
}

type GateAskedEvent = Extract<SessionEvent, { kind: 'gateAsked' }>;
type GateAnsweredEvent = Extract<SessionEvent, { kind: 'gateAnswered' }>;

function gateAnswerFor(events: readonly SessionEvent[], callId: string): { answer: GateAnswer; words?: string } | undefined {
  const asked = events.find((e): e is GateAskedEvent => e.kind === 'gateAsked' && e.callId === callId);
  if (!asked) return undefined;
  const answered = events.find((e): e is GateAnsweredEvent => e.kind === 'gateAnswered' && e.gateId === asked.gateId);
  return answered ? { answer: answered.answer, words: answered.words } : undefined;
}

/** A skip or typed gate answer resolves a call without a tool-result event. */
function isCallResolved(events: readonly SessionEvent[], callId: string): boolean {
  if (events.some((e) => e.kind === 'toolResult' && e.callId === callId)) return true;
  const answer = gateAnswerFor(events, callId);
  return answer !== undefined && (answer.answer === 'skip' || answer.answer === 'words');
}

/** Finds this call occurrence's gate, including one answered before a reload. */
function existingGateId(log: SessionLog, scope: 'tool' | 'plan', callId: string, assistantSeq: number): string | undefined {
  const events = eventsAfter(log, assistantSeq);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'gateAsked' && e.scope === scope && e.callId === callId) return e.gateId;
  }
  return undefined;
}

/** Records an undo watermark for each stage the plan has entered. */
function syncStageCheckpoints(log: SessionLog, deps: LoopDeps): void {
  if (!hasPlanEvent(log)) return;
  const events = jobEvents(log);
  const done = new Set<number>();
  for (const e of events) {
    if (e.kind === 'checkpoint' && e.stageIndex !== undefined) done.add(e.stageIndex);
  }
  for (const e of events) {
    if (e.kind === 'stage' && !done.has(e.index)) {
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
function endJob(
  log: SessionLog,
  deps: LoopDeps,
  end: { outcome: JobOutcome; summary?: string; question?: true },
): void {
  append(log, { kind: 'jobEnd', ...end, undoIndex: deps.undoStackSize() });
}

/** A successful evaluation after a write marks the current plan stage complete. */
const STAGE_BOUNDARY_TOOL = 'evaluate_map';

/** Advances after an evaluation only when the current stage contains a successful write. */
function advanceStageAtBoundary(log: SessionLog, deps: LoopDeps, toolName: string): void {
  if (toolName !== STAGE_BOUNDARY_TOOL) return;
  let stageCount = 0;
  let current = 0;
  let wroteSinceStage = false;
  for (const e of jobEvents(log)) {
    if (e.kind === 'plan') { stageCount = e.stages.length; current = 0; wroteSinceStage = false; }
    else if (e.kind === 'stage') { current = e.index; wroteSinceStage = false; }
    else if (e.kind === 'toolResult' && !e.isError && deps.executor.isWrite(e.name)) wroteSinceStage = true;
  }
  if (stageCount === 0 || !wroteSinceStage) return;
  if (current >= stageCount - 1) return;
  advanceStage(log, current + 1);
}

export function isJobActive(log: SessionLog): boolean {
  const events = eventsOf(log);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'jobEnd' || e?.kind === 'incident') return false;
    if (e?.kind === 'order') return true;
  }
  return false;
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('The wait was aborted.', 'AbortError');
  const err = new Error('The wait was aborted.');
  err.name = 'AbortError';
  return err;
}

function realSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Resolves a call's supervision gate, reusing this occurrence's persisted question and answer. */
async function resolveGate(log: SessionLog, deps: LoopDeps, part: ToolPart, assistantSeq: number): Promise<boolean | 'aborted'> {
  const gate = shouldGate({
    tool: part.name, isWrite: deps.executor.isWrite(part.name), isWide: deps.executor.isWide(part.name),
    oversight: deps.oversight, allowAll: hasAllowAlways(log),
  });
  if (!gate) return true;
  const gateId = existingGateId(log, 'tool', part.callId, assistantSeq)
    ?? askGate(log, {
      scope: 'tool', callId: part.callId, turnSeq: assistantSeq,
      summary: deps.executor.describe({ name: part.name, args: part.input }),
    });
  try {
    const { answer } = await awaitGate(log, gateId, deps.signal);
    return answer === 'allow' || answer === 'allow-always';
  } catch {
    return 'aborted';
  }
}

/** Stamps whether a result writes and which assistant turn emitted its call. */
function resultStamp(deps: LoopDeps, name: string, assistantSeq: number): { write: boolean; turnSeq: number } {
  return { write: deps.executor.isWrite(name), turnSeq: assistantSeq };
}

/** A job may file its initial plan and one revision. */
const MAX_PLAN_FILINGS = 2;

async function handleUpdatePlan(log: SessionLog, deps: LoopDeps, part: ToolPart, assistantSeq: number): Promise<ReissueSignal> {
  const stages = parseStages(part.input.stages);
  if (!stages) {
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, isError: true,
      content: '(system) update_plan needs a non-empty "stages" array of objects, each with a label. Example: stages: [{"label":"terrace the north hills"}]. Reissue the call with a valid plan.',
      ...resultStamp(deps, part.name, assistantSeq),
    });
    return 'continue';
  }
  // Reject excess revisions before supervision because the plan cannot be accepted.
  if (jobEvents(log).filter((e) => e.kind === 'plan').length >= MAX_PLAN_FILINGS) {
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, isError: true,
      detail: { damper: true },
      content: '(system) The plan has already been revised once; the stage list is a commitment the '
        + 'user is reading, not a scratchpad. Keep building the current plan\'s remaining stages, and '
        + 'put any leftover ideas in your closing summary instead of a new plan.',
      ...resultStamp(deps, part.name, assistantSeq),
    });
    return 'continue';
  }

  const needsGate = deps.oversight !== 'yolo' && !hasAllowAlways(log);
  let approved = true;
  if (needsGate) {
    const gateId = existingGateId(log, 'plan', part.callId, assistantSeq)
      ?? askGate(log, {
        scope: 'plan', callId: part.callId, turnSeq: assistantSeq,
        summary: deps.executor.describe({ name: part.name, args: part.input }),
      });
    try {
      const { answer } = await awaitGate(log, gateId, deps.signal);
      approved = answer === 'allow' || answer === 'allow-always';
    } catch {
      return 'aborted';
    }
  }
  if (approved) {
    const revision = jobEvents(log).filter((e) => e.kind === 'plan').length + 1;
    append(log, { kind: 'plan', stages, revision });
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, content: 'Plan set.', isError: false,
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
async function processCalls(
  log: SessionLog, deps: LoopDeps, toolParts: readonly ToolPart[], badCallIds: ReadonlySet<string>, assistantSeq: number,
  toolNames: ReadonlySet<string>, resuming = false,
): Promise<ReissueSignal> {
  const sleep = deps.sleep ?? realSleep;
  /** Whether this batch has landed a write that requires pacing before the next write. */
  let built = false;
  for (const part of toolParts) {
    if (isCallResolved(eventsAfter(log, assistantSeq), part.callId)) continue;
    if (deps.signal.aborted) return 'aborted';
    if (pauseIsPending(log)) { append(log, { kind: 'paused' }); return 'paused'; }

    if (badCallIds.has(part.callId)) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, content: REISSUE_MESSAGE, isError: true,
        ...resultStamp(deps, part.name, assistantSeq),
      });
      continue;
    }
    if (part.name === 'suggest_reply' && toolNames.has(part.name)) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, content: 'Noted.', isError: false,
        ...resultStamp(deps, part.name, assistantSeq),
      });
      continue;
    }
    if (part.name === 'update_plan' && toolNames.has(part.name)) {
      const outcome = await handleUpdatePlan(log, deps, part, assistantSeq);
      if (outcome !== 'continue') return outcome;
      continue;
    }

    // A delegated helper may have partially edited the map without a resumable child log.
    if (resuming && part.name === 'delegate_task') {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, isError: true,
        content: '(system) The helper run was interrupted by a reload. Edits it already made are on the map; '
          + 'look at the map, then delegate a fresh task for what remains.',
        ...resultStamp(deps, part.name, assistantSeq),
      });
      continue;
    }

    // Reuse an identical failure until a success or map write changes its basis.
    const streak = repeatedFailure(log, { name: part.name, args: part.input });
    if (streak) {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, isError: true,
        content: repeatRefusal(streak),
        detail: { damper: true, repeatRefused: true },
        ...resultStamp(deps, part.name, assistantSeq),
      });
      continue;
    }

    const proceed = await resolveGate(log, deps, part, assistantSeq);
    if (proceed === 'aborted') return 'aborted';
    if (deps.signal.aborted) return 'aborted';
    if (pauseIsPending(log)) { append(log, { kind: 'paused' }); return 'paused'; }
    if (!proceed) continue; // skipped: the projection synthesizes the model-visible result

    if (deps.executor.isWrite(part.name) && !hasJobCheckpoint(log)) {
      append(log, { kind: 'checkpoint', undoIndex: deps.undoStackSize(), label: 'job' });
    }

    const isWrite = deps.executor.isWrite(part.name);
    // Pace consecutive writes and let the job signal interrupt the wait.
    if (isWrite && built) {
      try {
        await sleep(BUILD_BEAT_MS, deps.signal);
      } catch {
        return 'aborted';
      }
    }

    if (deps.signal.aborted) return 'aborted';
    if (pauseIsPending(log)) { append(log, { kind: 'paused' }); return 'paused'; }
    let executed: ExecutedResult;
    try {
      executed = await deps.executor.execute({ callId: part.callId, name: part.name, args: part.input });
      if (isWrite) built = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      executed = {
        content: `(system) The tool crashed: ${redactSecrets(message)}. Try a different approach or ask the user.`,
        isError: true,
      };
    }
    let content = executed.content;
    let dampered = false;
    if (executed.isError) {
      const nudge = verbatimRetryNudge(log, { name: part.name, args: part.input });
      if (nudge) { content = `${content}\n\n${nudge}`; dampered = true; }
    }
    if (executed.detail?.reverted) {
      const nudge = revertNudge(log, part.name);
      if (nudge) { content = `${content}\n\n${nudge}`; dampered = true; }
    }
    const detail = dampered ? { ...(executed.detail ?? {}), damper: true as const } : executed.detail;
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, content, isError: executed.isError,
      ...(executed.image !== undefined ? { image: executed.image } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...resultStamp(deps, part.name, assistantSeq),
    });
    if (!executed.isError) advanceStageAtBoundary(log, deps, part.name);
  }
  return 'continue';
}

/** Delay in milliseconds between writes in one tool-call batch, allowing each map change to render. */
export const BUILD_BEAT_MS = 420;

/** Resumes any calls left over from an interrupted previous `runJob` (a pause, an abort, or a
 *  reload): the latest assistant turn's calls that have neither a result nor a settled gate. */
async function resumeLeftoverCalls(
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

  const outcome = await processCalls(log, deps, toolParts, deriveBadCallIds(latest), assistantSeq, toolNames, true);
  if (outcome === 'paused') return 'paused';
  if (outcome === 'aborted') { endJob(log, deps, { outcome: 'aborted' }); return 'aborted'; }
  return undefined; // resolved; fall through to the main loop for the job's next turn
}

/** Remaining provider pacing delay in milliseconds, measured from the latest assistant event. */
function pacingWaitMs(log: SessionLog): number {
  const floor = pacingFloorMs(eventsOf(log));
  if (floor === 0) return 0;
  const events = eventsOf(log);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'assistant') return Math.max(0, floor - (log.now() - e.at));
  }
  return 0;
}

/** Counts persisted retries for the unfinished turn so reloads cannot reset the retry cap. */
function retryAttemptsLogged(log: SessionLog): number {
  const events = jobEvents(log);
  let sinceAssistant = -1;
  events.forEach((e, i) => { if (e.kind === 'assistant') sinceAssistant = i; });
  const scoped = sinceAssistant < 0 ? events : events.slice(sinceAssistant + 1);
  return scoped.filter((e) => e.kind === 'retry').length;
}

/** Streams one attempt with a child abort controller so an idle timeout does not abort the job. */
async function streamOnce(deps: LoopDeps, req: AdapterRequest): Promise<AssembledTurn> {
  const assembler = createAssembler();
  const turn = new AbortController();
  const onAbort = (): void => turn.abort();
  if (deps.signal.aborted) turn.abort();
  else deps.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const source = deps.adapter.stream(req, turn.signal);
    for await (const ev of withIdleTimeout(source, { onIdle: () => turn.abort(), signal: deps.signal })) {
      assembler.push(ev);
      deps.onLive?.(assembler.snapshot());
    }
  } finally {
    deps.signal.removeEventListener('abort', onAbort);
  }
  return assembler.finish();
}

/** Runs one logical turn, reusing its request across retries and rebuilding it after compaction. */
async function runAdapterTurn(
  log: SessionLog, deps: LoopDeps, buildRequest: () => AdapterRequest,
  opts: { estimate: (s: string) => number; sleep: (ms: number, signal: AbortSignal) => Promise<void> },
): Promise<AssistantEvent | 'incident' | 'aborted'> {
  let req = buildRequest();
  let attempt = retryAttemptsLogged(log);
  for (;;) {
    if (deps.signal.aborted) { deps.onLive?.(null); return 'aborted'; }
    const assembled = await streamOnce(deps, req);

    if (!assembled.error && !deps.signal.aborted) {
      const ev = append(log, {
        kind: 'assistant', parts: assembled.parts, stop: assembled.stop,
        ...(assembled.usage !== undefined ? { usage: assembled.usage } : {}),
        // Raw provider blocks are replayable only with the model that produced them.
        ...(assembled.raw !== undefined ? { raw: assembled.raw, rawModel: deps.model } : {}),
        // Record adapter normalization quirks beside the normalized parts.
        ...(assembled.quirks !== undefined ? { quirks: assembled.quirks } : {}),
      });
      deps.onLive?.(null);
      return ev as AssistantEvent;
    }

    const err = deps.signal.aborted ? { cls: 'abort' as const, detail: 'The turn was aborted.' } : assembled.error!;
    if (err.cls === 'abort') {
      const ev = append(log, {
        kind: 'assistant', parts: assembled.parts, stop: 'aborted',
        ...(assembled.usage !== undefined ? { usage: assembled.usage } : {}),
        ...(assembled.raw !== undefined ? { raw: assembled.raw, rawModel: deps.model } : {}),
      });
      deps.onLive?.(null);
      return ev as AssistantEvent;
    }

    if (err.cls === 'overflow') {
      const ok = await compact(log, { adapter: deps.adapter, model: deps.model, signal: deps.signal, estimate: opts.estimate });
      if (deps.signal.aborted) { deps.onLive?.(null); return 'aborted'; }
      if (!ok) {
        deps.onLive?.(null);
        append(log, { kind: 'incident', error: err });
        return 'incident';
      }
      req = buildRequest(); // replay on the (now hopefully smaller) derived window
      continue;
    }

    attempt++;
    if (!isRetryable(err.cls) || attempt >= MAX_TURN_RETRIES) {
      deps.onLive?.(null);
      append(log, { kind: 'incident', error: err });
      return 'incident';
    }
    const delayMs = retryDelayMs(attempt, err);
    append(log, { kind: 'retry', attempt, cls: err.cls, delayMs });
    try {
      await opts.sleep(delayMs, deps.signal);
    } catch {
      deps.onLive?.(null);
      return 'aborted';
    }
  }
}

export async function runJob(log: SessionLog, deps: LoopDeps): Promise<JobOutcome | 'paused'> {
  const maxTurns = deps.maxTurns ?? MAX_TURNS_DEFAULT;
  const contextWindow = deps.contextWindow ?? 128000;
  const estimate = deps.estimate ?? defaultEstimate;
  const budgetTokens = Math.min(deps.budgetTokens, contextWindow - COMPACTION_RESERVE);
  const sleep = deps.sleep ?? realSleep;
  const toolNames = new Set(deps.tools.map((t) => t.name));
  // Delivery and review nudges apply only when the advertised tool set can write.
  const canWrite = deps.tools.some((t) => deps.executor.isWrite(t.name));

  const resumed = await resumeLeftoverCalls(log, deps, toolNames);
  if (resumed) return resumed;

  for (;;) {
    if (deps.signal.aborted) { endJob(log, deps, { outcome: 'aborted' }); return 'aborted'; }
    if (pauseIsPending(log)) { append(log, { kind: 'paused' }); return 'paused'; }
    deliverSteers(log);
    syncStageCheckpoints(log, deps);

    if (needsCompaction(log, { contextWindow, estimate })) {
      const ok = await compact(log, { adapter: deps.adapter, model: deps.model, signal: deps.signal, estimate });
      if (deps.signal.aborted) { endJob(log, deps, { outcome: 'aborted' }); return 'aborted'; }
      if (!ok && needsCompaction(log, { contextWindow, estimate })) {
        append(log, { kind: 'incident', error: { cls: 'overflow', detail: 'The conversation no longer fits the context window and cannot be shortened further.' } });
        endJob(log, deps, { outcome: 'incident' });
        return 'incident';
      }
    }

    const turnsUsed = countAssistantTurns(log);
    if (turnsUsed >= maxTurns) { endJob(log, deps, { outcome: 'capped' }); return 'capped'; }

    const silent = silentTurnState(log);
    if (silent.n >= 3) { endJob(log, deps, { outcome: 'done' }); return 'done'; }

    // Length-stopped turns leave the replay window; a nudge carries the failure into the next try.
    const lengthStreak = consecutiveLengthStops(log);
    if (lengthStreak >= 3) {
      append(log, { kind: 'incident', error: { cls: 'overflow', detail: 'Three turns in a row were cut off by the output limit; the job cannot make progress this way.' } });
      endJob(log, deps, { outcome: 'incident' });
      return 'incident';
    }

    const isFinalTurn = turnsUsed === maxTurns - 1;
    const appendSystemNote = isFinalTurn
      ? capMessage()
      : lengthStopNudge(lengthStreak) ?? budgetWarning(turnsUsed, maxTurns) ?? planOwedNudge(log)
        ?? (silent.reasoningOnly ? reasoningOnlyNudge(silent.n) : emptyTurnNudge(silent.n));

    const buildRequest = (): AdapterRequest => ({
      system: deps.system,
      messages: deriveMessages(log, { budgetTokens, estimate, appendSystemNote }),
      tools: deps.tools, model: deps.model, sameModel: deps.sameModel,
    });

    // Apply the provider pacing floor learned from rate-limit responses; the job signal can skip it.
    const wait = pacingWaitMs(log);
    if (wait > 0) {
      try {
        await sleep(wait, deps.signal);
      } catch {
        endJob(log, deps, { outcome: 'aborted' });
        return 'aborted';
      }
    }

    const turnOutcome = await runAdapterTurn(log, deps, buildRequest, { estimate, sleep });
    if (turnOutcome === 'incident') { endJob(log, deps, { outcome: 'incident' }); return 'incident'; }
    if (turnOutcome === 'aborted') { endJob(log, deps, { outcome: 'aborted' }); return 'aborted'; }

    // Preserve all terminal text, but mark a question only when the model chose the ending.
    // Provider truncation and aborts may leave question-mark fragments that must not await input.
    const finalText = turnOutcome.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('').trim();
    const question = turnOutcome.stop !== 'length' && QUESTION_END.test(finalText);
    const settle = (outcome: 'done' | 'capped' | 'aborted'): void => {
      endJob(log, deps, {
        outcome,
        ...(finalText ? { summary: finalText } : {}),
        ...(question && outcome !== 'aborted' ? { question: true as const } : {}),
      });
    };

    // Before settling a write-capable job, request delivery when nothing landed and review when a
    // substantial build landed with enough turns remaining. Each nudge fires once and is recorded
    // as a systemNote for replay. Delivery and review may occur on separate closes of the same job.
    const nudgeDelivery = (): boolean => {
      if (hasLandedWrite(log)) return false;
      if (jobEvents(log).some((e) => e.kind === 'systemNote' && e.note === 'delivery')) return false;
      append(log, { kind: 'systemNote', note: 'delivery', text: deliveryNudge() });
      return true;
    };
    const nudgeReview = (): boolean => {
      if (landedWriteCount(log) < REVIEW_MIN_WRITES) return false;
      if (maxTurns - countAssistantTurns(log) < REVIEW_MIN_TURNS_LEFT) return false;
      if (jobEvents(log).some((e) => e.kind === 'systemNote' && e.note === 'review')) return false;
      append(log, { kind: 'systemNote', note: 'review', text: reviewNudge() });
      return true;
    };
    // An unfinished filed plan receives one close nudge to continue or identify the blocked stage.
    const nudgePlanClose = (): boolean => {
      const text = unfinishedPlanNudge(log);
      if (text === undefined) return false;
      if (jobEvents(log).some((e) => e.kind === 'systemNote' && e.note === 'plan-close')) return false;
      append(log, { kind: 'systemNote', note: 'plan-close', text });
      return true;
    };
    // A closing question settles directly unless a substantial landed build still needs review.
    const answerClose = (): boolean => {
      if (!canWrite) return false;
      if (question) return landedWriteCount(log) >= REVIEW_MIN_WRITES && nudgeReview();
      return nudgeDelivery() || nudgePlanClose() || nudgeReview();
    };

    if (turnOutcome.stop === 'aborted') { settle('aborted'); return 'aborted'; }
    if (isFinalTurn) { settle('capped'); return 'capped'; }

    const toolParts = turnOutcome.parts.filter(isToolPart);
    if (toolParts.length === 0) {
      if (finalText.length > 0) {
        if (answerClose()) continue;
        settle('done');
        return 'done';
      }
      continue; // a silent turn: the next iteration nudges, or gives up gracefully past 2
    }

    const callOutcome = await processCalls(log, deps, toolParts, deriveBadCallIds(turnOutcome), turnOutcome.seq, toolNames);
    if (callOutcome === 'paused') return 'paused';
    if (callOutcome === 'aborted') { endJob(log, deps, { outcome: 'aborted' }); return 'aborted'; }
    // A text response followed only by reply suggestions is already a complete closing turn.
    if (finalText.length > 0 && toolParts.every((p) => p.name === 'suggest_reply' && toolNames.has(p.name))) {
      if (answerClose()) continue;
      settle('done');
      return 'done';
    }
  }
}
