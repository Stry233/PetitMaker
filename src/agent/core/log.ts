import type { SessionEvent, SessionEventInput } from './types';

/** The append-only session log. Everything model-visible is an event here; projections
 *  in project-messages.ts / project-view.ts are the only readers of the array. */
export interface SessionLog {
  readonly events: SessionEvent[];
  /** Injected clock: Date.now in the app, a constant in tests. */
  readonly now: () => number;
  nextSeq: number;
  /** Subscribers notified once per append; the store bridges this to React. */
  readonly listeners: Set<() => void>;
}

export function createLog(now: () => number = Date.now): SessionLog {
  return { events: [], now, nextSeq: 1, listeners: new Set() };
}

/** `Object.freeze` is shallow, so a naive freeze of the event still leaves `assistant.parts`,
 *  `plan.stages` and `toolResult.detail` mutable underneath it. Recursively freezes every
 *  plain-object/array field EXCEPT `raw`: that field holds the provider SDK's own object, opaque
 *  and echoed verbatim to callers that may still expect to hold a live reference to it, so it is
 *  left exactly as the provider handed it over. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    if (key === 'raw') continue;
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export function append(log: SessionLog, input: SessionEventInput): SessionEvent {
  const ev = deepFreeze({ ...input, seq: log.nextSeq++, at: log.now() }) as SessionEvent;
  log.events.push(ev);
  for (const l of log.listeners) l();
  return ev;
}

export function eventsOf(log: SessionLog): readonly SessionEvent[] {
  return log.events;
}

export function subscribe(log: SessionLog, fn: () => void): () => void {
  log.listeners.add(fn);
  return () => log.listeners.delete(fn);
}
