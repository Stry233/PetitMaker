/**
 * What the loop counts about the current job: identical-failure streaks, landed writes, reviews,
 * plan progress and truncated turns, plus the turn budgets. The text it answers with is `nudges.ts`.
 */
import { stageProgress, type Part, type SessionEvent } from './types';
import type { SessionLog } from './log';
import { jobEvents } from './job-reads';
import { OccurrenceScan, occurrenceKey } from './occurrence';
import type { ToolFacts } from './tool-facts';
import { resultStatus, retainedWrite } from './tool-result';

/** Ordinary jobs run to this many assistant turns before the cap message ends them. */
export const MAX_TURNS_DEFAULT = 40;
/** A subagent delegate gets a shorter leash: it is meant to answer one narrow question. */
export const SUBAGENT_MAX_TURNS = 20;
/** The turn-budget warning fires once, this many turns before the cap. */
export const BUDGET_WARN_AT = 5;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** A tool call's identity for the dampers below: the name plus its args serialized with keys in
 *  sorted order at every level, so two calls that differ only in argument-object key order (a
 *  model re-emitting the same call) collide on the same signature. */
function callSignature(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(canonicalize(args))}`;
}

/** One `toolResult` joined back to the call it answers via the assistant `tool` part that minted
 *  its occurrence, plus the facts the dampers below read off it. Every count is scoped to the
 *  current job (`job-reads.ts:jobEvents`), so a failure in an earlier job escalates nothing here. */
interface ResultFact {
  /** Signature of the answered call; undefined when its minting was never logged (should not happen). */
  sig: string | undefined;
  /** isError or a post-stroke rollback, including a partially retained stroke. */
  failed: boolean;
  /** Retained edits change the basis for earlier failures, even after a partial rollback. */
  wroteMap: boolean;
  content: string;
  /** The loop answered this call itself as a repeat refusal: not an executed attempt. */
  refused: boolean;
}

/** Every `toolResult` in the job as a `ResultFact`, in log order, each bound to the call occurrence
 *  it answers in one forward pass. */
function resultFacts(events: readonly SessionEvent[]): ResultFact[] {
  const scan = new OccurrenceScan();
  const sigByOccurrence = new Map<string, string>();
  const facts: ResultFact[] = [];
  for (const ev of events) {
    if (ev.kind === 'assistant') {
      scan.see(ev);
      for (const part of ev.parts as Part[]) {
        if (part.kind === 'tool') sigByOccurrence.set(occurrenceKey(part.callId, ev.seq), callSignature(part.name, part.input));
      }
    } else if (ev.kind === 'toolResult') {
      const failed = resultStatus(ev) !== 'ok';
      facts.push({
        sig: sigByOccurrence.get(scan.keyOf(ev.callId, ev.seq)),
        failed,
        wroteMap: retainedWrite(ev),
        content: ev.content,
        refused: ev.detail?.repeatRefused === true,
      });
    }
  }
  return facts;
}

/** Every failed result's call signature, skipping the ones whose call was never logged. */
function failedSignatures(events: readonly SessionEvent[]): string[] {
  return resultFacts(events)
    .filter((f): f is ResultFact & { sig: string } => f.failed && f.sig !== undefined)
    .map((f) => f.sig);
}

/**
 * The consecutive identical-failure streak `call` would extend: how many times this exact
 * (tool, canonicalized-args) call has failed since the map last changed (a successful write) or
 * the same call last succeeded, plus the executed failure's own error text to echo when one ran. `undefined`
 * means fresh ground and the call should run. Failures with other signatures do not break the
 * streak: they changed nothing on the map either, so the identical retry still earns the identical
 * answer.
 */
export function repeatedFailure(
  log: SessionLog,
  call: { name: string; args: Record<string, unknown> },
): { error?: string; repeats: number } | undefined {
  const target = callSignature(call.name, call.args);
  const facts = resultFacts(jobEvents(log));
  let repeats = 0;
  let error: string | undefined;
  for (let i = facts.length - 1; i >= 0; i--) {
    const f = facts[i]!;
    if (f.wroteMap) break;
    if (f.sig !== target) continue;
    if (!f.failed) break;
    repeats++;
    // Backward walk, so the final assignment is the streak's oldest non-refused failure: the
    // executed one, whose content is the tool's own error rather than an echo of an echo.
    if (!f.refused) error = f.content;
  }
  if (repeats === 0) return undefined;
  return error === undefined ? { repeats } : { error, repeats };
}

/** Counts write results with retained work, including partially rejected strokes. */
export function landedWriteCount(log: SessionLog): number {
  return resultFacts(jobEvents(log)).filter((f) => f.wroteMap).length;
}

/** A partial edit is enough to make the zero-edit delivery nudge inappropriate. */
export function hasLandedWrite(log: SessionLog): boolean {
  return landedWriteCount(log) > 0;
}

/** A successful map read after the latest retained edit already provides a verification opportunity. */
export function hasRecentVerification(log: SessionLog, facts: Pick<ToolFacts, 'verifies'>): boolean {
  let verified = false;
  for (const event of jobEvents(log)) {
    if (event.kind !== 'toolResult') continue;
    if (retainedWrite(event)) verified = false;
    else if (!event.isError && facts.verifies(event.name)) verified = true;
  }
  return verified;
}

/** How many landed writes make a build worth a review pass. Below this the job placed a bench or
 *  patched a tile: there is nothing to weigh against the order, and the beat would cost a small
 *  job an extra close for nothing. */
export const REVIEW_MIN_WRITES = 3;

/** The fewest turns that must remain at a close for the review beat to fire. The pass it invites
 *  is a look, the fixes (whose tool calls never execute on the final turn), a refusal or revert
 *  answered, and a close that can still settle done rather than capped; a tighter window converts
 *  a finished job into a capped re-summary. Above `BUDGET_WARN_AT` so the beat and the wrap-up
 *  warning can never both be standing instructions on the same job. */
export const REVIEW_MIN_TURNS_LEFT = 6;

/** Where the job's filed plan stands: how many stages it names and which one is current.
 *  `undefined` where no plan was filed. The index also accepts the stage count when all stages are complete. */
export function planProgress(log: SessionLog): { stageCount: number; current: number; nextLabel: string } | undefined {
  let stages: { label: string }[] | null = null;
  let index = 0;
  for (const e of jobEvents(log)) {
    if (e.kind === 'plan') { stages = e.stages; index = 0; }
    else if (e.kind === 'stage') index = e.index;
  }
  if (!stages || stages.length === 0) return undefined;
  const { done, current } = stageProgress(index, stages.length);
  return { stageCount: stages.length, current: done, nextLabel: stages[current]!.label };
}

/** How many assistant turns in a row (most recent first) the provider cut short at its output
 *  limit. Scoped to this job, and counted over assistant events alone: the reissue results a
 *  truncated batch produces sit between the turns and must not break the run. */
export function consecutiveLengthStops(log: SessionLog): number {
  const assistants = jobEvents(log).filter(
    (e): e is Extract<SessionEvent, { kind: 'assistant' }> => e.kind === 'assistant',
  );
  let n = 0;
  for (let i = assistants.length - 1; i >= 0; i--) {
    if (assistants[i]?.stop !== 'length') break;
    n++;
  }
  return n;
}

/** How many times this exact call has already failed in the job; a success in between does not reset it. */
export function verbatimFailures(log: SessionLog, call: { name: string; args: Record<string, unknown> }): number {
  const target = callSignature(call.name, call.args);
  return failedSignatures(jobEvents(log)).filter((sig) => sig === target).length;
}

/** How many of the named tool's edits post-stroke rules have rolled back in the job. */
export function revertCount(log: SessionLog, toolName: string): number {
  let reverts = 0;
  for (const ev of jobEvents(log)) {
    if (ev.kind === 'toolResult' && ev.name === toolName && ev.detail?.reverted) reverts++;
  }
  return reverts;
}
