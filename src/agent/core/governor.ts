import type { Part, SessionEvent, ToolResultDetail } from './types';
import { eventsOf, type SessionLog } from './log';
import { OccurrenceScan, occurrenceKey } from './occurrence';

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
export function callSignature(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(canonicalize(args))}`;
}

/** Events since the current job's own `order`, the scope both dampers below count over: a call
 *  that failed in an earlier job must not escalate a call in this one. Also loop.ts's own scope
 *  for every one of its job-local counters, so it imports this rather than keeping a duplicate. */
export function jobEvents(log: SessionLog): readonly SessionEvent[] {
  const events = eventsOf(log);
  const lastOrder = events.reduce(
    (found, ev, i) => (ev.kind === 'order' ? i : found),
    -1,
  );
  return lastOrder < 0 ? events : events.slice(lastOrder + 1);
}

/** One `toolResult` joined back to the call it answers via the assistant `tool` part that minted
 *  its OCCURRENCE, plus the facts the dampers below read off it. */
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

/** A rejected command can leave other commands from the same stroke committed. */
export function retainedWrite(result: { write?: boolean; isError: boolean; detail?: ToolResultDetail }): boolean {
  if (!result.write || (result.detail?.reverted && !result.detail.partialRevert)) return false;
  const { cells, objects, partialRevert } = result.detail ?? {};
  if (cells !== undefined || objects !== undefined) return (cells ?? 0) + (objects ?? 0) > 0;
  return partialRevert === true || !result.isError;
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
      const failed = ev.isError || ev.detail?.reverted === true;
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
 * the same call last succeeded, plus the executed failure's own error text to echo. `undefined`
 * means fresh ground and the call should run. Failures with OTHER signatures do not break the
 * streak: they changed nothing on the map either, so the identical retry still earns the identical
 * answer.
 */
export function repeatedFailure(
  log: SessionLog,
  call: { name: string; args: Record<string, unknown> },
): { error: string; repeats: number } | undefined {
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
    // Backward walk, so the final assignment is the streak's OLDEST non-refused failure: the
    // executed one, whose content is the tool's own error rather than an echo of an echo.
    if (!f.refused) error = f.content;
  }
  if (repeats === 0) return undefined;
  return { error: error ?? 'the same refusal as before', repeats };
}

/** The answer a byte-identical retry of a just-failed call gets INSTEAD of a result: the loop
 *  refuses to execute it (`loop.ts:processCalls`), repeats the error the model already has, and
 *  past the first repeat points at a way to new ground. The first line stays prose that names the
 *  refusal, since it is what the projection and the run dump show as the op's summary. */
export function repeatRefusal(streak: { error: string; repeats: number }): string {
  const base = '(system) Not run: this exact call just failed with:\n'
    + `${streak.error}\n`
    + 'Change the arguments or the approach; sending it again unchanged will not run.';
  if (streak.repeats < 2) return base;
  return `${base}\n`
    + 'Look before acting: inspect_region the area you are editing, or load_skill for a relevant '
    + 'technique, and build from what the map actually shows.';
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
export function hasRecentVerification(log: SessionLog): boolean {
  let verified = false;
  for (const event of jobEvents(log)) {
    if (event.kind !== 'toolResult') continue;
    if (retainedWrite(event)) verified = false;
    else if (!event.isError && ['view_map', 'inspect_region', 'get_objects', 'get_annotations'].includes(event.name)) verified = true;
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

/** Sent once at a zero-edit close; an impossible or unspecified request may correctly leave no edits. */
export function deliveryNudge(): string {
  return '(system) No edit has landed. Check whether that is appropriate for this request. '
    + 'If the user asked for advice, gave no buildable subject, needs to choose an alternative, '
    + 'or requested something that cannot be done, make no substitute edits. Give the answer, '
    + 'explain the constraint, or ask one short question ending in a question mark. Otherwise, '
    + 'if the requested edit is feasible and already authorized, deliver that edit. Do not '
    + 'invent a different task to satisfy this check. Your next close is final.';
}

/** The answer a landed build's first closing turn gets INSTEAD of settling (`loop.ts:runJob`): one
 *  review pass scoped to the ORDER, not the map. It sends the model back to the order's own words
 *  and the ground they name, and forbids additions; it points at view_map and never at
 *  evaluate_map, whose whole-map scorecard grades dimensions the order never asked for and invites
 *  edits beyond its scope. Sent once per job; the close after it is final whatever it says. */
export function reviewNudge(): string {
  return '(system) Verify the result against the user request and preserved work. Use the existing '
    + 'tool results; use a focused view_map or read only if something is uncertain. If all requested '
    + 'outcomes are satisfied, close now. Otherwise make only the smallest necessary correction '
    + 'and verify it once. Do not add features, clear and rebuild completed work, or chase '
    + 'whole-map scores. Intentional planting is not an error. State any unmet constraint '
    + 'honestly; ask the user only when their decision is needed. Your next close is final.';
}

/** Where the job's filed plan stands: how many stages it names and which one is current.
 *  `undefined` where no plan was filed. The index also accepts the stage count when all stages are complete. */
export function planProgress(log: SessionLog): { stageCount: number; current: number; nextLabel: string } | undefined {
  let stages: { label: string }[] | null = null;
  let current = 0;
  for (const e of jobEvents(log)) {
    if (e.kind === 'plan') { stages = e.stages; current = 0; }
    else if (e.kind === 'stage') current = e.index;
  }
  if (!stages || stages.length === 0) return undefined;
  return { stageCount: stages.length, current, nextLabel: stages[Math.min(current, stages.length - 1)]!.label };
}

/** The answer a close with plan stages still standing gets INSTEAD of settling: finish them, or say
 *  plainly which stage cannot be done and why. Sent once per job; the close after it is final. */
export function unfinishedPlanNudge(log: SessionLog): string | undefined {
  const plan = planProgress(log);
  if (!plan || plan.current >= plan.stageCount) return undefined;
  const remaining = plan.stageCount - plan.current;
  return `(system) The plan records ${remaining} of ${plan.stageCount} stages as unfinished (current: `
    + `"${plan.nextLabel}"). Check their requested outcomes against the work already present. `
    + 'Report completed stages with update_plan completedStages; do not rebuild them or run '
    + 'evaluate_map to move the plan. Finish only missing requested work, or explain what is '
    + 'blocked and why. Your next close is final.';
}

/** Escalates once a call has already failed with these exact arguments once before in this job
 *  (a success in between does not reset the count; only failures are counted at all). */
export function verbatimRetryNudge(
  log: SessionLog,
  call: { name: string; args: Record<string, unknown> },
): string | undefined {
  const target = callSignature(call.name, call.args);
  const count = failedSignatures(jobEvents(log)).filter((sig) => sig === target).length;
  if (count < 1) return undefined;
  return '(system) This exact call has already failed once with these same arguments, so repeating '
    + 'it again will not help. Look before acting with a find_* tool, load_skill for a relevant '
    + 'technique, or ask the user instead of retrying it verbatim.';
}

/** Escalates once one tool's edits have already been reverted once before in this job: the
 *  pattern is the strategy, not any one coordinate, so the nudge asks for a different approach
 *  rather than a retry at a different spot. */
export function revertNudge(log: SessionLog, toolName: string): string | undefined {
  const events = jobEvents(log);
  let reverts = 0;
  for (const ev of events) {
    if (ev.kind === 'toolResult' && ev.name === toolName && ev.detail?.reverted) reverts++;
  }
  if (reverts < 1) return undefined;
  // Four reverts make inspection a precondition for another call.
  if (reverts >= 4) {
    return `(system) STOP: ${reverts} ${toolName} edits have reverted in this job. Do not call it `
      + 'again until you have LOOKED — inspect_region or view_map the exact target — and are acting '
      + 'on ground the look confirmed clear. Repeating the probe builds nothing.';
  }
  return `(system) ${toolName}'s edits keep reverting, which points at the approach rather than `
    + 'where it is aimed. Change strategy: look at the map with a find_* tool, load_skill for the '
    + 'relevant technique, or ask the user before trying again.';
}

/** Fires exactly once, at the moment `BUDGET_WARN_AT` turns remain (never before, never again
 *  after, since the loop calls this once per turn and the remaining count only ever falls). */
export function budgetWarning(turnsUsed: number, maxTurns: number): string | undefined {
  const remaining = maxTurns - turnsUsed;
  if (remaining !== BUDGET_WARN_AT) return undefined;
  return `(system) ${remaining} turns remain before the iteration limit ends this job. Wrap up `
    + 'now, or ask the user for more room if the job genuinely needs it.';
}

/** A bounded nudge for a turn that produced NOTHING AT ALL: no text, no tool call, and nothing
 *  thought either. The model gets two chances to continue on its own before the loop gives up and
 *  closes the job politely instead. Its sentence is only true of that shape, which is why a turn
 *  that reasoned gets `reasoningOnlyNudge` instead. */
export function emptyTurnNudge(consecutiveEmpty: number): string | undefined {
  if (consecutiveEmpty < 1 || consecutiveEmpty > 2) return undefined;
  return '(system) That turn produced no text and no tool calls. Continue the job, or ask the '
    + 'user a clarifying question if something is blocking it.';
}

/** The same bound, for a turn that DID work and simply kept it to itself: reasoning arrived, no
 *  text and no call did. Telling that turn it "produced no text and no tool calls" is false about
 *  the half that happened, and a model told it did nothing has no way to know which half of the
 *  sentence to act on. So the note names what it sees and asks for the missing half. */
export function reasoningOnlyNudge(consecutiveSilent: number): string | undefined {
  if (consecutiveSilent < 1 || consecutiveSilent > 2) return undefined;
  return '(system) That turn was all reasoning: no message and no tool call reached the user. '
    + 'State your conclusion as text, or call a tool.';
}

/** How many assistant turns in a row (most recent first) the provider cut short at its output
 *  limit. Scoped to this job, and counted over ASSISTANT events alone: the reissue results a
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

/** A bounded nudge for a turn the provider truncated. It exists because the truncated turn itself
 *  is unreplayable (`DROPPED_STOPS`): the turn AND the reissue results it produced are dropped from
 *  the projection, so without this the next request is byte-identical to the one that just
 *  truncated and the model re-emits the same oversized call until the iteration cap. Bounded at 2
 *  for the same reason `emptyTurnNudge` is: past that the loop ends the job instead. */
export function lengthStopNudge(streak: number): string | undefined {
  if (streak < 1 || streak > 2) return undefined;
  return '(system) Your last turn was cut off by the output limit before it finished, and its tool '
    + 'calls were not run. Do not repeat the same call: issue smaller calls (fewer cells, a smaller '
    + 'area) or give a shorter answer.';
}

/** The final turn appended when the iteration limit is reached outright: the job ends right
 *  after, so the one way out this names is handing the rest back to the user. */
export function capMessage(): string {
  return '(system) The iteration limit is reached and this job is ending now. Summarize what was '
    + 'done and ask the user how to continue.';
}
