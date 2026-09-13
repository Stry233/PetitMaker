import { append, createLog, deepFreeze, eventsOf, type SessionLog } from '../core/log';
import { isCallResolved, isJobActive } from '../core/loop';
import { jobEvents } from '../core/governor';

/** Resuming must re-plan interrupted operations rather than replay decisions made with erased context. */
function retirePendingCalls(log: SessionLog): void {
  const recent = jobEvents(log);
  const last = [...recent].reverse().find((e) => e.kind === 'assistant');
  if (!last || last.kind !== 'assistant') return;
  const after = recent.filter((e) => e.seq > last.seq);
  for (const part of last.parts) {
    if (part.kind !== 'tool' || isCallResolved(after, part.callId)) continue;
    for (const e of after) {
      if (e.kind === 'gateAsked' && e.callId === part.callId
        && !after.some((answer) => answer.kind === 'gateAnswered' && answer.gateId === e.gateId)) {
        append(log, { kind: 'gateAnswered', gateId: e.gateId, answer: 'skip' });
      }
    }
    append(log, {
      kind: 'toolResult', callId: part.callId, name: part.name, turnSeq: last.seq, isError: true, write: false,
      content: 'Conversation history was cleared while this operation was pending. Its outcome is unknown. Inspect the current map before planning further changes; do not repeat the operation without checking its effects.',
      detail: { damper: true },
    });
  }
}

/** Erasure replaces the log so in-flight requests cannot append into the retained conversation. */
export function eraseRecords(log: SessionLog, cleared: ReadonlySet<number>): SessionLog {
  if (cleared.size === 0) return log;
  const events = eventsOf(log);
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  const deleted = new Set([...cleared].filter((seq) => Number.isSafeInteger(seq) && seq > 0
    && (!bySeq.has(seq) || bySeq.get(seq)?.kind === 'order')));
  if (deleted.size === 0) return log;
  // Deleted order markers also identify partial records left by storage quota pruning.
  const boundaries = [...new Set([
    ...events.filter((e) => e.kind === 'order').map((e) => e.seq), ...deleted,
  ])].sort((a, b) => a - b);
  const firstDeleted = Math.min(...deleted);
  let boundary = -1;
  let changed = false;
  const retained = events.filter((e) => {
    while (boundary + 1 < boundaries.length && boundaries[boundary + 1]! <= e.seq) boundary++;
    const remove = deleted.has(boundaries[boundary] ?? -1)
      || e.kind === 'compaction' && e.seq > firstDeleted;
    changed ||= remove;
    return !remove;
  }).map((e) => {
    // Opaque provider reasoning can carry earlier context even when visible text does not.
    if (e.kind !== 'assistant' || e.seq < firstDeleted || e.raw === undefined) return e;
    const { raw: _raw, rawModel: _rawModel, ...neutral } = e;
    changed = true;
    return deepFreeze(neutral);
  });
  if (!changed) return log;
  const next = createLog(log.now);
  next.events.push(...retained);
  next.nextSeq = log.nextSeq;
  if (isJobActive(next)) {
    retirePendingCalls(next);
    if (next.events[next.events.length - 1]?.kind !== 'paused') append(next, { kind: 'paused' });
  }
  return next;
}
