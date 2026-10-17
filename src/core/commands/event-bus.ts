type Handler<T> = (data: T) => void;

/** A bus over a wider event map passes where a narrower one is asked for: the kernel takes a bus of
 *  its own events and the editor hands it the bus of every editor event. */
export class EventBus<EventMap> {
  private listeners = new Map<PropertyKey, Set<Handler<never>>>();

  /** Returns the unsubscribe, the same as `off(event, handler)`. */
  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.listeners.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    // Unlike `base/signal.ts:createSignal`, a listener's throw is logged and the rest still run: the
    // toast and the map flash ride one event, and a throw would otherwise reach the executor.
    for (const handler of [...handlers]) {
      try {
        (handler as Handler<EventMap[K]>)(data);
      } catch (err) {
        console.error(`[event-bus] "${String(event)}" listener failed:`, err);
      }
    }
  }
}

/** The publishing side of a bus, for code that announces events and never listens. */
export type EventSink<EventMap> = Pick<EventBus<EventMap>, 'emit'>;
