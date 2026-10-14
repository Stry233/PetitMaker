/**
 * What the turn loop reads off the session log: the current job's events, its gates, checkpoints
 * and plan, how many turns and retries it has spent, and whether it is still running.
 */
import { eventsOf, type SessionLog } from './log';
import { pacingFloorMs } from './retry';
import { thoughtSize, type GateAnswer, type SessionEvent } from './types';

export type AssistantEvent = Extract<SessionEvent, { kind: 'assistant' }>;

/** Events since the current job's own `order`: the scope of every job-local count. */
export function jobEvents(log: SessionLog): readonly SessionEvent[] {
  const events = eventsOf(log);
  const lastOrder = events.reduce(
    (found, ev, i) => (ev.kind === 'order' ? i : found),
    -1,
  );
  return lastOrder < 0 ? events : events.slice(lastOrder + 1);
}

/** Events after the assistant turn that emitted a particular tool-call occurrence. */
export function eventsAfter(log: SessionLog, sinceSeq: number): readonly SessionEvent[] {
  return eventsOf(log).filter((e) => e.seq > sinceSeq);
}

/** A pause remains pending until the loop records `paused` or the job records `resumed`. */
export function pauseIsPending(log: SessionLog): boolean {
  const events = jobEvents(log);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'pauseRequested') return true;
    if (e?.kind === 'resumed' || e?.kind === 'paused') return false;
  }
  return false;
}

export function hasPlanEvent(log: SessionLog): boolean {
  return jobEvents(log).some((e) => e.kind === 'plan');
}

/** `allow-always` applies to the session rather than one job. */
export function hasAllowAlways(log: SessionLog): boolean {
  return eventsOf(log).some((e) => e.kind === 'gateAnswered' && e.answer === 'allow-always');
}

export function hasJobCheckpoint(log: SessionLog): boolean {
  return jobEvents(log).some((e) => e.kind === 'checkpoint' && e.label === 'job');
}

/** The undo-stack size recorded when the current job's first write ran; `0` before any write. */
export function jobUndoFloor(log: SessionLog): number {
  for (const e of jobEvents(log)) if (e.kind === 'checkpoint' && e.label === 'job') return e.undoIndex;
  return 0;
}

export function countAssistantTurns(log: SessionLog): number {
  return jobEvents(log).filter((e) => e.kind === 'assistant').length;
}

/**
 * Counts trailing turns that produced neither text nor tool calls. Reasoning-only silence receives
 * a distinct nudge. Length stops break this streak and are handled by their own counter.
 */
export function silentTurnState(log: SessionLog): { n: number; reasoningOnly: boolean } {
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

/** The tool calls of a turn that must not run: every call of a turn the output limit cut off, and
 *  any call whose arguments did not parse (its part keeps `rawInput`). The one reading, for a live
 *  turn and a persisted one alike. */
export function deriveBadCallIds(ev: Pick<AssistantEvent, 'parts' | 'stop'>): Set<string> {
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
export function isCallResolved(events: readonly SessionEvent[], callId: string): boolean {
  if (events.some((e) => e.kind === 'toolResult' && e.callId === callId)) return true;
  const answer = gateAnswerFor(events, callId);
  return answer !== undefined && (answer.answer === 'skip' || answer.answer === 'words');
}

/** Finds this call occurrence's gate, including one answered before a reload. */
export function existingGateId(log: SessionLog, scope: 'tool' | 'plan', callId: string, assistantSeq: number): string | undefined {
  const events = eventsAfter(log, assistantSeq);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === 'gateAsked' && e.scope === scope && e.callId === callId) return e.gateId;
  }
  return undefined;
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

/** Remaining provider pacing delay in milliseconds, measured from the latest assistant event. */
export function pacingWaitMs(log: SessionLog): number {
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
export function retryAttemptsLogged(log: SessionLog): number {
  const events = jobEvents(log);
  let sinceAssistant = -1;
  events.forEach((e, i) => { if (e.kind === 'assistant') sinceAssistant = i; });
  const scoped = sinceAssistant < 0 ? events : events.slice(sinceAssistant + 1);
  return scoped.filter((e) => e.kind === 'retry').length;
}
