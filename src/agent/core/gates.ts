import type { GateAnswer, GateOption } from './types';
import { append, eventsOf, subscribe, type SessionLog } from './log';

export type Oversight = 'strict' | 'checkpoint' | 'yolo';

/** Whether a call needs a gate before it runs. `allowAll` (a session-wide "always allow" answer)
 *  and a non-write call never gate; `yolo` never gates; `strict` gates every write; `checkpoint`
 *  gates only a WIDE write, and only while no plan is approved yet (an approved plan already
 *  covers the wide moves it lists). */
export function shouldGate(input: {
  tool: string; isWrite: boolean; isWide: boolean; oversight: Oversight;
  planApproved: boolean; allowAll: boolean;
}): boolean {
  if (input.allowAll || !input.isWrite || input.oversight === 'yolo') return false;
  if (input.oversight === 'strict') return true;
  return input.isWide && !input.planApproved;
}

/** Appends `gateAsked` and returns its gateId. The id is minted from `nextSeq` (the seq `append`
 *  is about to assign), which the log already guarantees unique and monotonic within it.
 *
 *  `quickAnswers`/`options` ride through untouched: whatever the ask carries is what the record
 *  shows it offered, and this function invents neither. */
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

/** The most recent `gateAsked` with no matching `gateAnswered` yet, or undefined if the log has
 *  none outstanding. */
export function pendingGate(
  log: SessionLog,
): { gateId: string; scope: 'tool' | 'plan'; callId?: string; summary: string } | undefined {
  const events = eventsOf(log);
  const answered = new Set<string>();
  for (const ev of events) if (ev.kind === 'gateAnswered') answered.add(ev.gateId);
  for (const ev of [...events].reverse()) {
    if (ev.kind === 'gateAsked' && !answered.has(ev.gateId)) {
      return { gateId: ev.gateId, scope: ev.scope, callId: ev.callId, summary: ev.summary };
    }
  }
  return undefined;
}

/**
 * Appends the answering half of the pair. Throws on an unknown gateId, on an already-answered one,
 * and on one whose JOB HAS SETTLED under it — three ways the answer would mean nothing, and the
 * caller turns each into a visible refusal.
 *
 * THE SETTLE CASE IS THE REACHABLE ONE. A double answer cannot happen through the panel (the
 * buttons unmount the moment the verdict lands), but the ask card's handler stays live for the frame
 * between `jobEnd` reaching the log and React committing the render that removes it — a provider
 * timeout, a turn cap, or the user's own Stop landing as their finger comes down. The pair was still
 * (asked, unanswered), so the append was legal; the fold attaches a `gateAnswered` to the job that
 * asked, and there is no longer one, so the event landed in the persisted session and folded into
 * nothing. A PAUSE is not a settle: `loop.ts:existingGateId` re-enters the same gate on resume, so
 * the question is being held and an answer to it still reaches a loop.
 */
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

/**
 * WHETHER A HUMAN EXPLICITLY ALLOWED THIS CALL, at its own gate.
 *
 * The export disclosure distinguishes an edit a person APPROVED from one the model simply made under
 * a standing permission (`core/provenance/types.ts`: `AiAccepted` vs `AiWrite`), and the panel's
 * whole gate machinery exists to obtain the first. `allow-always` is NOT one of them: it is the
 * session-wide standing answer `shouldGate` reads as `allowAll`, which is exactly what the
 * disclosure means by an AI write. A call that was never gated answers false too — there was no
 * approval to report, and inventing one would be the disclosure claiming a press nobody made.
 */
export function callApproved(log: SessionLog, callId: string): boolean {
  const events = eventsOf(log);
  const gateIds = new Set<string>();
  for (const ev of events) if (ev.kind === 'gateAsked' && ev.callId === callId) gateIds.add(ev.gateId);
  if (gateIds.size === 0) return false;
  // The LAST answer for this call's gates: a re-entered gate (a reload mid-wait) can leave more than
  // one ask behind the one answer that let the call run.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.kind === 'gateAnswered' && gateIds.has(ev.gateId)) return ev.answer === 'allow';
  }
  return false;
}

function abortError(): Error {
  // DOMException exists in browsers and in jsdom; a bare Error with the same `name` is the
  // documented fallback for environments (plain Node without jsdom) that lack it.
  if (typeof DOMException !== 'undefined') return new DOMException('The gate wait was aborted.', 'AbortError');
  const err = new Error('The gate wait was aborted.');
  err.name = 'AbortError';
  return err;
}

/** Resolves once `gateId` is answered, reading from history first (a reload can resume a wait on
 *  an already-answered gate) and otherwise subscribing to the log rather than polling. Rejects if
 *  `signal` aborts first; the subscription is always torn down on either path. */
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
