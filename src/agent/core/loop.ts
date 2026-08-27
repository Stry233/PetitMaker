/** The v3 turn loop: `runJob` drives adapter turns from the log and back into it. Its only state
 *  IS the log (plus the in-flight assembler for the turn currently streaming), so a fresh call
 *  over the same log resumes exactly where the last one stopped: an unanswered gate is re-entered
 *  rather than re-asked, a call left over from a pause/reload is finished before a new turn is
 *  requested, and every counter (turns used, consecutive silent turns, whether a checkpoint or a
 *  plan already landed) is read back off the log rather than kept in a mutable field. */
import type { Adapter, AdapterRequest } from '../providers/types';
import { redactSecrets } from '../security/redact';
import { createAssembler, type AssembledTurn } from './assembler';
import { compact, needsCompaction, COMPACTION_RESERVE } from './compaction';
import { isRetryable } from './errors';
import { askGate, awaitGate, shouldGate, type Oversight } from './gates';
import {
  budgetWarning, capMessage, consecutiveLengthStops, deliveryNudge, emptyTurnNudge, hasLandedWrite,
  jobEvents, landedWriteCount, lengthStopNudge, reasoningOnlyNudge, repeatedFailure, repeatRefusal,
  revertNudge, reviewNudge, verbatimRetryNudge, MAX_TURNS_DEFAULT, REVIEW_MIN_TURNS_LEFT,
  REVIEW_MIN_WRITES,
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
  /** May throw: the loop catches it and reports a redacted crash message as an `isError` result
   *  rather than letting the exception escape and strand the job with no `jobEnd`. */
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

/** A closing message that ENDS in a question mark is waiting on the user. Both marks count: the
 *  reply is written in the user's own language, and a CJK sentence ends in the fullwidth one. The
 *  trailing-space tail holds for untrimmed text too, so the pattern answers the same either way. */
const QUESTION_END = /[?？]\s*$/;

function isToolPart(p: Part): p is ToolPart { return p.kind === 'tool'; }

/** Events strictly after `sinceSeq`: the window a specific tool-call OCCURRENCE owns. A callId
 *  alone is not a safe key across occurrences — a synthesized id can repeat across turns, and
 *  nothing stops a provider from reusing a real id either — so any lookup
 *  keyed on `callId` must also be bounded to the events after the assistant turn that MINTED this
 *  particular occurrence, never the whole job. */
function eventsAfter(log: SessionLog, sinceSeq: number): readonly SessionEvent[] {
  return eventsOf(log).filter((e) => e.seq > sinceSeq);
}

/** True only while `pauseRequested` is the most recent of the three pause-lifecycle events in this
 *  job: a `paused` already answered it (the loop returned), and a `resumed` clears it for the next
 *  `runJob` call to proceed past. */
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

/** "Always allow" is a session-wide answer (spec: gates.ts), so it is read off the WHOLE log, not
 *  scoped to the current job the way every other counter here is. */
function hasAllowAlways(log: SessionLog): boolean {
  return eventsOf(log).some((e) => e.kind === 'gateAnswered' && e.answer === 'allow-always');
}

function hasJobCheckpoint(log: SessionLog): boolean {
  return jobEvents(log).some((e) => e.kind === 'checkpoint' && e.label === 'job');
}

function countAssistantTurns(log: SessionLog): number {
  return jobEvents(log).filter((e) => e.kind === 'assistant').length;
}

/** The trailing run of SILENT assistant turns (most recent first): turns that reached the user
 *  with neither text nor a tool call, whatever else the model did with them. `n` is how many in a
 *  row, and `reasoningOnly` says whether the LATEST of them carried reasoning — the one the next
 *  request's note speaks about.
 *
 *  Silence is not idleness, and the two get different notes: a turn that thought at length and
 *  emitted nothing did work, and telling it that it "produced no text and no tool calls" is false
 *  about the half that happened. The BOUND is shared, since either way nothing reached the
 *  user and a third such turn ends the job.
 *
 *  A turn the provider truncated (`stop === 'length'`) is not silent at all, however little of it
 *  arrived: it was cut off rather than quiet, and `consecutiveLengthStops` is the counter that owns
 *  it. That is a BREAK and not a skip — a truncation ENDS a silent run rather than punching a hole
 *  in it, because the nudge the truncation earns is itself an intervention the earlier silence has
 *  not been answered under. Without the exclusion an extended-thinking model hitting its output cap
 *  mid-reasoning satisfies BOTH streaks, and this gate stands first in `runJob`, which settled
 *  `jobEnd {outcome:'done'}` and reported success for a job that never answered. */
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
    // `thoughtSize` is the shared answer to what a reasoning part is worth, so a blank delta reads
    // as no thought here and counts as none in the panel's projection either.
    if (n === 0) reasoningOnly = ev.parts.some((p) => p.kind === 'reasoning' && thoughtSize(p) > 0);
    n++;
  }
  return { n, reasoningOnly };
}

/** Reconstructs the assembler's `badCalls` from the persisted event alone: a `length` stop poisons
 *  every call in the batch, and an individually unparseable call still carries its `rawInput`. */
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

/** A call needs no further loop attention once it has a real result, or a settled gate that itself
 *  stands in for one (skip/words): the projection synthesizes the model-visible side for both. */
function isCallResolved(events: readonly SessionEvent[], callId: string): boolean {
  if (events.some((e) => e.kind === 'toolResult' && e.callId === callId)) return true;
  const answer = gateAnswerFor(events, callId);
  return answer !== undefined && (answer.answer === 'skip' || answer.answer === 'words');
}

/** This call OCCURRENCE's own `gateAsked`, answered or not: scoped to events strictly after
 *  `assistantSeq`, the seq of the assistant event that carries this occurrence — never the whole
 *  job, since a repeated callId (a synthesized one from an older log, or a real one a
 *  buggy provider reissues) would otherwise re-enter a DIFFERENT call's gate. `undefined` means
 *  this occurrence has never been gated at all. Used instead of `pendingGate` because `pendingGate`
 *  only sees an UNANSWERED gate: a reload landing between the user's approval and the call
 *  actually running must resume onto the ANSWERED one, not ask a second time and hang waiting for
 *  an answer nobody is being asked to give. */
function existingGateId(log: SessionLog, scope: 'tool' | 'plan', callId: string, assistantSeq: number): string | undefined {
  const events = eventsAfter(log, assistantSeq);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'gateAsked' && e.scope === scope && e.callId === callId) return e.gateId;
  }
  return undefined;
}

/** Appends `checkpoint {label:'stage'}` for any `stage` event the job has not yet checkpointed.
 *  The spec's checkpoint is written "at job start, first write, stage starts", and this is the
 *  third of those: `advanceStageAtBoundary` names the stage, the next step boundary banks the undo
 *  watermark for it, which is what the record's per-stage rewind offer reads. */
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

/**
 * THE ONE WAY A JOB SETTLES, so no exit can forget to bank the undo depth it settled at.
 *
 * That number is the upper half of the pair the panel's take-back reads: the job's first
 * `checkpoint` says where its writes began, this says where they ended, and everything above it is
 * the user's own later work. Written at every exit, the aborts and the incidents included — a
 * stopped job's edits are exactly the ones its stop card offers to take back.
 */
function endJob(
  log: SessionLog,
  deps: LoopDeps,
  end: { outcome: JobOutcome; summary?: string; question?: true },
): void {
  append(log, { kind: 'jobEnd', ...end, undoIndex: deps.undoStackSize() });
}

/** The tool call that MARKS a stage boundary. The workflow prompt's own contract is "call
 *  evaluate_map as you finish each stage, not only at the end", so a measurement is the one thing
 *  in the log that says a stage is behind the model. Nothing else can say it: a plan carries no
 *  per-stage partition of the op list, and the model is told never to re-issue `update_plan`
 *  mid-build, so a re-filed plan means a REVISION (which resets the rail) rather than progress. */
const STAGE_BOUNDARY_TOOL = 'evaluate_map';

/** Moves the plan rail on if this call is a stage boundary.
 *
 *  A measurement only counts once a WRITE has landed since the current stage began, which settles
 *  the two calls the same prompt asks for that are NOT boundaries: the baseline evaluation before
 *  any building (no write yet, so stage 0 keeps standing) and a re-evaluation after fixing a
 *  regression (no write since the advance, so it cannot skip the stage the model is still on). The
 *  last stage never advances past itself — the job's own end settles it, and the projection folds
 *  `doneCount` FROM `currentIndex`, so there is no index that would read as "all of them done". */
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

/** Resolves whether a call may run: no gate needed (`true`), an answered gate (`true`/`false` for
 *  allow/skip), or the wait itself was aborted. Re-enters an already-asked gate for THIS
 *  occurrence (answered or not) rather than asking twice, which is what makes both a mid-wait
 *  reload AND a reload landing right after the user's own answer (before the call ran) resumable:
 *  `awaitGate` already returns a historical answer immediately. `assistantSeq` is the seq of the
 *  assistant event carrying this occurrence, so a repeated callId from an earlier occurrence in
 *  the same job is never mistaken for this one. */
async function resolveGate(log: SessionLog, deps: LoopDeps, part: ToolPart, assistantSeq: number): Promise<boolean | 'aborted'> {
  const gate = shouldGate({
    tool: part.name, isWrite: deps.executor.isWrite(part.name), isWide: deps.executor.isWide(part.name),
    oversight: deps.oversight, planApproved: hasPlanEvent(log), allowAll: hasAllowAlways(log),
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

/** The two fields EVERY result the loop appends carries (see the `toolResult` member in
 *  `types.ts` for why they are stamped here rather than folded later). `assistantSeq` is the seq of
 *  the assistant event that minted the call this result answers. */
function resultStamp(deps: LoopDeps, name: string, assistantSeq: number): { write: boolean; turnSeq: number } {
  return { write: deps.executor.isWrite(name), turnSeq: assistantSeq };
}

/** `update_plan` never reaches the executor: the loop itself appends the `plan` event (only on
 *  allow, and only once `stages` validates) and its own `toolResult`, since without one the
 *  projection would read the call as an unanswered orphan and report it to the model as a plain
 *  error. A malformed `stages` argument is rejected before any gate is asked: there is no reason
 *  to interrupt the user for a plan the loop already knows it cannot log. */
/** How many plans a job may file before a refile is churn the loop answers itself: the first is
 *  the plan, the second a legitimate revision, the third onward is the dissatisfaction spiral a
 *  live run burned 80 turns in (plan refiled four times around an inspect-and-remove loop). */
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
  // THE CHURN BRAKE, before the gate for the repeat-refusal's reason: a refile that will not be
  // accepted must not cost the user an approval. The stage list is a commitment the user reads.
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
  // skip/words: nothing more to append here; the projection synthesizes the model-visible side
  // from the gate pair alone, exactly as it does for an ordinary tool call.
  return 'continue';
}

/** Processes every call in `toolParts` (all from the ONE assistant event at `assistantSeq`) that
 *  is not already resolved, in order: pause between calls, bad-args reissue, the two ungated call
 *  shapes (`suggest_reply`/`update_plan`), then the gate-and-execute path shared by every other
 *  tool. Safe to call twice over the SAME list (a resumed run re-derives `isCallResolved` from the
 *  log and skips what already landed). `assistantSeq` bounds every callId-keyed lookup to events
 *  after THIS occurrence, so a repeated callId from an earlier turn is never confused with it.
 *  `toolNames` is this job's advertised tool set (`deps.tools`, by name): the two ungated shapes
 *  intercept ONLY a name actually offered to the model, so a run wired without them (a subagent
 *  via `wireSchemas({subagent:true})`) never has a stray `update_plan`/`suggest_reply` call
 *  special-cased into the PARENT's plan/log surface — it falls through to the ordinary
 *  gate-and-execute path, where the executor's own unknown-tool error is the answer.
 *
 *  `resuming` says this list came off the log rather than off the turn that just streamed, which is
 *  the one thing a caller knows and the log cannot say: a delegated helper is the single call that
 *  must NOT be retried in that case (see the guard below). */
async function processCalls(
  log: SessionLog, deps: LoopDeps, toolParts: readonly ToolPart[], badCallIds: ReadonlySet<string>, assistantSeq: number,
  toolNames: ReadonlySet<string>, resuming = false,
): Promise<ReissueSignal> {
  const sleep = deps.sleep ?? realSleep;
  /** Whether a write in THIS batch has already landed on the map, which is what the beat below is
   *  spent between. A skipped or crashed call landed nothing and paces nothing. */
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

    // A HELPER IS NEVER REPLAYED. Every other call the loop resumes is safe to re-run — it either
    // never started or is idempotent enough that finishing it is better than dropping it — but a
    // delegated helper is a whole job of its own: an unresolved one means its edits are half on the
    // map with no record of how far it got (the child log dies with the call), so running it again
    // would build a second time over its own leftovers. The refusal stands in front of the gate
    // too: a call that will never run must not cost the user an approval.
    if (resuming && part.name === 'delegate_task') {
      append(log, {
        kind: 'toolResult', callId: part.callId, name: part.name, isError: true,
        content: '(system) The helper run was interrupted by a reload. Edits it already made are on the map; '
          + 'look at the map, then delegate a fresh task for what remains.',
        ...resultStamp(deps, part.name, assistantSeq),
      });
      continue;
    }

    // A REFUSED CALL, RESENT UNCHANGED, IS REFUSED WITHOUT RUNNING: identical arguments against an
    // unchanged map earn the identical error, so the loop answers with that error itself
    // (`repeatedFailure` scopes the streak: a success with these args, or any successful write
    // since the failure, reopens the ground). Seated before the gate for the same reason the
    // delegate guard above is: a call that will not run must not cost the user an approval.
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
    if (!proceed) continue; // skipped: the projection synthesizes the model-visible result

    if (deps.executor.isWrite(part.name) && !hasJobCheckpoint(log)) {
      append(log, { kind: 'checkpoint', undoIndex: deps.undoStackSize(), label: 'job' });
    }

    const isWrite = deps.executor.isWrite(part.name);
    // THE CONSTRUCTION BEAT (see the note above this function): a real pause before a write that
    // follows one, so the edits arrive at a pace the map can be watched changing at. It carries the
    // job's own signal, which is what lets a stop end the job HERE rather than after the wait.
    if (isWrite && built) {
      try {
        await sleep(BUILD_BEAT_MS, deps.signal);
      } catch {
        return 'aborted';
      }
    }

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

/**
 * THE CONSTRUCTION BEAT, in ms: how long the loop waits before a WRITE that follows one.
 *
 * A batch of writes otherwise lands in a single microtask burst, and on the glass that is the map
 * jumping to its finished state with the working animation never having played a frame. The pause is
 * spent HERE rather than in a renderer, because a render delay would hold the panel's report back
 * while the edits had already landed — the map and the record would disagree about what had happened
 * and when.
 *
 * NOT A DECORATION, WHICH IS WHY IT DOES NOT READ A MOTION PREFERENCE. This layer is below the
 * interface and cannot ask it anything; what the beat sets is the PACE THE JOB EDITS AT, and a reader
 * who has asked for less motion has not asked for a run they cannot follow. (The alternative reading,
 * that a still map wants no pace at all, would need the preference threaded down as a dep.)
 *
 * IT IS A MAX WITH THE INTER-TURN COURTESY, NOT A SUM, by covering a different gap: `pacingWaitMs`
 * waits between TURNS and this waits between calls inside one batch, so no single gap is charged
 * twice.
 */
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

/** How long a paced session must still wait before its next request, in ms, or 0 for "go now". The
 *  gap is measured from the newest `assistant` event — the closest stamp the log holds to when the
 *  last request went out — and a session that has not closed a turn yet never waits. */
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

/** How many `retry` attempts the turn IN PROGRESS has already logged: every `retry` event in the
 *  job appended after its most recent `assistant` event (or since the job's own order, when no
 *  assistant event exists yet, i.e. every attempt so far belongs to the still-unfinished first
 *  turn). `runAdapterTurn` seeds its in-memory `attempt` counter from this rather than always
 *  starting at 0, since a process reload during a retry's sleep otherwise restarts the ladder from
 *  scratch and lets it exceed MAX_TURN_RETRIES across the reload (the counter was per-process, the
 *  cap is meant to be per-job). */
function retryAttemptsLogged(log: SessionLog): number {
  const events = jobEvents(log);
  let sinceAssistant = -1;
  events.forEach((e, i) => { if (e.kind === 'assistant') sinceAssistant = i; });
  const scoped = sinceAssistant < 0 ? events : events.slice(sinceAssistant + 1);
  return scoped.filter((e) => e.kind === 'retry').length;
}

/** One adapter attempt, bounded: the stream is consumed through `withIdleTimeout`, so a provider
 *  that stops sending without ending the response becomes a retryable error instead of a job that
 *  waits forever. The turn streams under its OWN controller, linked to the job's: the idle trip
 *  aborts that one to cancel the dead fetch, which leaves the job's signal untouched, so the next
 *  attempt streams normally and a genuine user abort still reads as an abort. The aborted adapter's
 *  own trailing event never arrives, since the wrapper has already returned. */
async function streamOnce(deps: LoopDeps, req: AdapterRequest): Promise<AssembledTurn> {
  const assembler = createAssembler();
  const turn = new AbortController();
  const onAbort = (): void => turn.abort();
  deps.signal.addEventListener('abort', onAbort, { once: true });
  try {
    const source = deps.adapter.stream(req, turn.signal);
    for await (const ev of withIdleTimeout(source, { onIdle: () => turn.abort() })) {
      assembler.push(ev);
      deps.onLive?.(assembler.snapshot());
    }
  } finally {
    deps.signal.removeEventListener('abort', onAbort);
  }
  return assembler.finish();
}

/** One logical turn through the retry ladder: the SAME request object is replayed for an ordinary
 *  retry (rule: a fresh `AdapterRequest` is built per TURN, not per attempt), rebuilt only after a
 *  successful compaction reshapes the window it derives from. Returns the appended `assistant`
 *  event on any stream outcome that is not itself an error (including a mid-stream `aborted` stop:
 *  the partial turn is preserved, and the caller decides the job's fate from its `stop`). */
async function runAdapterTurn(
  log: SessionLog, deps: LoopDeps, buildRequest: () => AdapterRequest,
  opts: { estimate: (s: string) => number; contextWindow: number; sleep: (ms: number, signal: AbortSignal) => Promise<void> },
): Promise<AssistantEvent | 'incident' | 'aborted'> {
  let req = buildRequest();
  let attempt = retryAttemptsLogged(log);
  for (;;) {
    if (deps.signal.aborted) { deps.onLive?.(null); return 'aborted'; }
    const assembled = await streamOnce(deps, req);

    if (!assembled.error) {
      const ev = append(log, {
        kind: 'assistant', parts: assembled.parts, stop: assembled.stop,
        ...(assembled.usage !== undefined ? { usage: assembled.usage } : {}),
        // `rawModel` rides with `raw` and only with it: the two are one fact (these bytes, from
        // this model), and a later request may be aimed at a different one.
        ...(assembled.raw !== undefined ? { raw: assembled.raw, rawModel: deps.model } : {}),
        // WHAT THE ADAPTER HAD TO NORMALIZE to produce these parts, recorded beside them: the log is
        // what the model was taken to have said, and this says how that reading was arrived at.
        ...(assembled.quirks !== undefined ? { quirks: assembled.quirks } : {}),
      });
      deps.onLive?.(null);
      return ev as AssistantEvent;
    }

    const err = assembled.error;
    if (err.cls === 'abort') {
      append(log, {
        kind: 'assistant', parts: assembled.parts, stop: 'aborted',
        ...(assembled.usage !== undefined ? { usage: assembled.usage } : {}),
        ...(assembled.raw !== undefined ? { raw: assembled.raw, rawModel: deps.model } : {}),
      });
      deps.onLive?.(null);
      return 'aborted';
    }

    if (err.cls === 'overflow') {
      const ok = await compact(log, { adapter: deps.adapter, model: deps.model, signal: deps.signal, estimate: opts.estimate });
      if (!ok && needsCompaction(log, { contextWindow: opts.contextWindow, estimate: opts.estimate })) {
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
  // Whether this job can build at all: the close notes below each ask for edits, so they only
  // speak to a run whose ADVERTISED tools include a write verb (a subagent's do; a chat-shaped
  // stub's do not).
  const canWrite = deps.tools.some((t) => deps.executor.isWrite(t.name));

  const resumed = await resumeLeftoverCalls(log, deps, toolNames);
  if (resumed) return resumed;

  for (;;) {
    if (pauseIsPending(log)) { append(log, { kind: 'paused' }); return 'paused'; }
    deliverSteers(log);
    syncStageCheckpoints(log, deps);

    if (needsCompaction(log, { contextWindow, estimate })) {
      const ok = await compact(log, { adapter: deps.adapter, model: deps.model, signal: deps.signal, estimate });
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

    // A truncated turn is dropped from the replay window along with the reissue results it
    // produced, so the request that follows it says nothing about the truncation: the nudge below
    // is the only thing that tells the model, and without it the next request is byte-identical to
    // the one that just truncated. Three in a row means the nudge is not landing, and the job
    // cannot make progress by asking a fourth time.
    const lengthStreak = consecutiveLengthStops(log);
    if (lengthStreak >= 3) {
      append(log, { kind: 'incident', error: { cls: 'overflow', detail: 'Three turns in a row were cut off by the output limit; the job cannot make progress this way.' } });
      endJob(log, deps, { outcome: 'incident' });
      return 'incident';
    }

    const isFinalTurn = turnsUsed === maxTurns - 1;
    const appendSystemNote = isFinalTurn
      ? capMessage()
      : lengthStopNudge(lengthStreak) ?? budgetWarning(turnsUsed, maxTurns)
        ?? (silent.reasoningOnly ? reasoningOnlyNudge(silent.n) : emptyTurnNudge(silent.n));

    const buildRequest = (): AdapterRequest => ({
      system: deps.system,
      messages: deriveMessages(log, { budgetTokens, estimate, appendSystemNote }),
      tools: deps.tools, model: deps.model, sameModel: deps.sameModel,
    });

    // INTER-TURN COURTESY, and only for a session an endpoint has already refused (`pacingFloorMs`).
    // An autopilot job spends a request per turn and can run forty of them, which on a shared
    // per-minute budget is the same limit discovered over and over; the ladder answers each refusal
    // and the pace is what stops earning them. The sleeper is the retry ladder's own, so the
    // countdown's press skips this wait too, and an abort during it ends the job like any other.
    const wait = pacingWaitMs(log);
    if (wait > 0) {
      try {
        await sleep(wait, deps.signal);
      } catch {
        endJob(log, deps, { outcome: 'aborted' });
        return 'aborted';
      }
    }

    const turnOutcome = await runAdapterTurn(log, deps, buildRequest, { estimate, contextWindow, sleep });
    if (turnOutcome === 'incident') { endJob(log, deps, { outcome: 'incident' }); return 'incident'; }
    if (turnOutcome === 'aborted') { endJob(log, deps, { outcome: 'aborted' }); return 'aborted'; }

    // What the turn SAID, and whether it is asking the user something. Every settle that has words
    // carries them — a cap was told to wrap up, so its text is a genuine closing, and an abort still
    // said what it said before the stop landed. The QUESTION is narrower: only text the model chose
    // the end of can ask one, so a provider-truncated turn (`length`) and a mid-stream abort are
    // never marked however they happen to end. A fragment cut at a question mark would otherwise
    // leave the job standing in the "waiting on you" state with nothing actually asked.
    const finalText = turnOutcome.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('').trim();
    const question = turnOutcome.stop !== 'length' && QUESTION_END.test(finalText);
    const settle = (outcome: 'done' | 'capped' | 'aborted'): void => {
      endJob(log, deps, {
        outcome,
        ...(finalText ? { summary: finalText } : {}),
        ...(question && outcome !== 'aborted' ? { question: true as const } : {}),
      });
    };

    // FINISHING MEANS DELIVERING, AND THE REVIEW SERVES THE ORDER. A closing turn (text, no real
    // tool call) on a job that could write owes one of two debts, and the loop answers a close
    // with AT MOST ONE note: a job that landed nothing gets the delivery contract (build the
    // order's intent on the map as it stands, an imperfect premise named and built through, or
    // state plainly that it cannot be done), and a job whose build LANDED (`REVIEW_MIN_WRITES`
    // writes or more; fewer is a touch-up with nothing to review) is sent back to the order for
    // one review pass scoped to its own words before the close stands, and only while
    // `REVIEW_MIN_TURNS_LEFT` turns remain for the pass to run and re-close in. The note itself
    // carries the scoping (`governor.ts:reviewNudge`): the loop cannot read an order's class, so a
    // constrained or repair order is not gated out here but told inside the note that its pass is
    // a verification, never an addition. The grounds are disjoint at any one close, each
    // note fires at most once per job, and the two ARE cumulative across closes by design: a
    // delivery-nudged job that then builds has taken on the second debt too, so a job is answered
    // at most twice however it closes. Each answer is a `systemNote` event, so the next request
    // replays it as a user message and the record keeps it honestly as the harness's own words.
    // The loop has no reading of an order's INTENT, so a job that was only ever a question gets
    // the delivery nudge too and simply restates its answer; a close that ends by asking the user
    // something is already waiting on them and settles as before.
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
    const answerClose = (): boolean => {
      if (!canWrite || question) return false;
      return nudgeDelivery() || nudgeReview();
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
    // The closing-suggestion shape the workflow prompt promises costs no extra round: a turn that
    // SAID something and whose only calls were `suggest_reply` has nothing left to do, so asking
    // for another turn would spend one on a model with nothing to answer (and usually get a
    // duplicate goodbye). Any real call in the batch means the turn is still working, and its
    // result decides the next one as before.
    if (finalText.length > 0 && toolParts.every((p) => p.name === 'suggest_reply' && toolNames.has(p.name))) {
      if (answerClose()) continue;
      settle('done');
      return 'done';
    }
  }
}
