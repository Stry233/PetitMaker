type Handler<T> = (data: T) => void;

export class EventBus<EventMap> {
  private listeners = new Map<keyof EventMap, Set<Handler<never>>>();

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as Handler<never>);
  }

  off<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): void {
    this.listeners.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    // Snapshot + per-handler isolation: the toast and the map flash ride the same
    // event, so one faulty listener silencing the rest turns every rule violation
    // into invisible feedback — and a throw here would also escape into the
    // EMITTER (the command executor), failing the user's action itself.
    for (const handler of [...handlers]) {
      try {
        (handler as Handler<EventMap[K]>)(data);
      } catch (err) {
        console.error(`[event-bus] "${String(event)}" listener failed:`, err);
      }
    }
  }
}
