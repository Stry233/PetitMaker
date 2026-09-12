import type { GateAnswer, GateOption } from './types';
import { append, eventsOf, subscribe, type SessionLog } from './log';

export type Oversight = 'strict' | 'checkpoint' | 'yolo';

/** Applies the selected supervision level to a prospective tool call. */
export function shouldGate(input: {
  tool: string; isWrite: boolean; isWide: boolean; oversight: Oversight;
  planApproved: boolean; allowAll: boolean;
}): boolean {
  if (input.allowAll || !input.isWrite || input.oversight === 'yolo') return false;
  if (input.oversight === 'strict') return true;
  return input.isWide && !input.planApproved;
}

/** Appends a question with a log-sequence-derived ID and returns that ID. */
export function askGate(
  log: SessionLog,
  ask: {
    scope: 'tool' | 'plan'; callId?: string; summary: string; turnSeq?: number;
    quickAnswers?: string[]; options?: GateOption[];
  },
): string {
  const gateId = `gate-${log.nextSeq}`;
  append(log, { kind: 'gateAsked', gateId, ...ask });
  return gateId;
}

/** The current job's most recent unanswered gate, if any. */
export function pendingGate(
  log: SessionLog,
): { gateId: string; scope: 'tool' | 'plan'; callId?: string; summary: string } | undefined {
  const events = eventsOf(log);
  const answered = new Set<string>();
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.kind === 'order' || ev.kind === 'jobEnd' || ev.kind === 'incident') return undefined;
    if (ev.kind === 'gateAnswered') answered.add(ev.gateId);
    if (ev.kind === 'gateAsked' && !answered.has(ev.gateId)) {
      return { gateId: ev.gateId, scope: ev.scope, callId: ev.callId, summary: ev.summary };
    }
  }
  return undefined;
}

/** Appends an answer only while its known gate is unanswered and its job remains active. */
export function answerGate(log: SessionLog, gateId: string, answer: GateAnswer, words?: string): void {
  const events = eventsOf(log);
  const askedAt = events.findIndex((ev) => ev.kind === 'gateAsked' && ev.gateId === gateId);
  if (askedAt === -1) throw new Error(`answerGate: unknown gateId ${gateId}`);
  const alreadyAnswered = events.some((ev) => ev.kind === 'gateAnswered' && ev.gateId === gateId);
  if (alreadyAnswered) throw new Error(`answerGate: gateId ${gateId} already answered`);
  const settled = events.slice(askedAt + 1).some((ev) => ev.kind === 'jobEnd' || ev.kind === 'incident');
  if (settled) throw new Error(`answerGate: gateId ${gateId} belongs to a job that has already ended`);
  append(log, { kind: 'gateAnswered', gateId, answer, words });
}

/** True only for a call explicitly approved at its own gate; standing permission is not explicit approval. */
export function callApproved(log: SessionLog, callId: string): boolean {
  const events = eventsOf(log);
  const gateIds = new Set<string>();
  for (const ev of events) if (ev.kind === 'gateAsked' && ev.callId === callId) gateIds.add(ev.gateId);
  if (gateIds.size === 0) return false;
  // A resumed wait can leave multiple gate questions; the latest answer controls the call.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.kind === 'gateAnswered' && gateIds.has(ev.gateId)) return ev.answer === 'allow';
  }
  return false;
}

function abortError(): Error {
  // Plain Node environments may not provide DOMException.
  if (typeof DOMException !== 'undefined') return new DOMException('The gate wait was aborted.', 'AbortError');
  const err = new Error('The gate wait was aborted.');
  err.name = 'AbortError';
  return err;
}

/** Resolves from a persisted or future answer and rejects if the signal aborts first. */
export function awaitGate(
  log: SessionLog,
  gateId: string,
  signal: AbortSignal,
): Promise<{ answer: GateAnswer; words?: string }> {
  const already = eventsOf(log).find((ev) => ev.kind === 'gateAnswered' && ev.gateId === gateId);
  if (already && already.kind === 'gateAnswered') {
    return signal.aborted
      ? Promise.reject(abortError())
      : Promise.resolve({ answer: already.answer, words: already.words });
  }
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => { unsubscribe(); reject(abortError()); };
    const unsubscribe = subscribe(log, () => {
      const ev = eventsOf(log).find((e) => e.kind === 'gateAnswered' && e.gateId === gateId);
      if (ev && ev.kind === 'gateAnswered') {
        unsubscribe();
        signal.removeEventListener('abort', onAbort);
        resolve({ answer: ev.answer, words: ev.words });
      }
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
