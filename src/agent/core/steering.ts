import { append, eventsOf, type SessionLog } from './log';

/** Appends `steer` and returns its seq, the id every later recall/delivery answers by. */
export function queueSteer(log: SessionLog, text: string): number {
  return append(log, { kind: 'steer', text }).seq;
}

/** Appends `steerRecalled` for `steerSeq` and returns true, unless it is already delivered,
 *  already recalled, or not a `steer` event at all, in which case it returns false and appends
 *  nothing: a recall answers a REAL pending steer or does not touch the log. */
export function recallSteer(log: SessionLog, steerSeq: number): boolean {
  const events = eventsOf(log);
  const isSteer = events.some((ev) => ev.kind === 'steer' && ev.seq === steerSeq);
  if (!isSteer) return false;
  const settled = events.some(
    (ev) =>
      (ev.kind === 'steerRecalled' || ev.kind === 'steerDelivered') && ev.steerSeq === steerSeq,
  );
  if (settled) return false;
  append(log, { kind: 'steerRecalled', steerSeq });
  return true;
}

/** Every queued steer with neither a `steerRecalled` nor a `steerDelivered` yet, in queue order. */
export function undeliveredSteers(log: SessionLog): { seq: number; text: string }[] {
  const events = eventsOf(log);
  const settled = new Set<number>();
  for (const ev of events) {
    if (ev.kind === 'steerRecalled' || ev.kind === 'steerDelivered') settled.add(ev.steerSeq);
  }
  return events
    .filter((ev) => ev.kind === 'steer' && !settled.has(ev.seq))
    .map((ev) => ({ seq: ev.seq, text: (ev as { text: string }).text }));
}

/** Appends `steerDelivered` for every currently pending steer, in queue order, and returns the
 *  count; a second call with nothing new queued appends nothing and returns 0. */
export function deliverSteers(log: SessionLog): number {
  const pending = undeliveredSteers(log);
  for (const { seq } of pending) append(log, { kind: 'steerDelivered', steerSeq: seq });
  return pending.length;
}
