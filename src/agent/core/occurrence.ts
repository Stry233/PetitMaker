import type { Part, SessionEvent } from './types';

/** A provider call id scoped to the assistant turn that emitted it. A provider can reuse an id
 *  across turns (a synthesized id colliding, or a real one a gateway repeats), so a lookup keyed on
 *  the bare id can bind a result to the wrong occurrence's call. */
export function occurrenceKey(callId: string, assistantSeq: number): string {
  return `${callId}#${assistantSeq}`;
}

/** A forward scan's binding of call ids to their occurrences: each id follows the nearest preceding
 *  assistant event carrying it, so a reissued id rebinds every later lookup to the new turn. */
export class OccurrenceScan {
  private readonly current = new Map<string, number>();

  /** Read an assistant event's tool calls as the current occurrences of their ids. */
  see(event: Extract<SessionEvent, { kind: 'assistant' }>): void {
    for (const part of event.parts as Part[]) {
      if (part.kind === 'tool') this.current.set(part.callId, event.seq);
    }
  }

  /** The occurrence a later event naming `callId` answers; an orphan keys on its own `seq`, so it
   *  never binds to a real call. */
  keyOf(callId: string, seq: number): string {
    return occurrenceKey(callId, this.current.get(callId) ?? seq);
  }
}
