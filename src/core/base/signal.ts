/**
 * A synchronous listener channel with an optional current value.
 *
 * `emit` stores the value `get` returns, then calls every listener subscribed when the emit began,
 * in subscription order, before it returns. A listener removed during an emit is still called for
 * that emit; one added during it is not. A listener's throw propagates and ends the emit unless
 * `onError` is given, which receives the error and lets the remaining listeners run.
 */
interface Signal<T = void> {
  get(): T;
  emit(value: T): void;
  /** Returns the unsubscribe. */
  subscribe(listener: (value: T, previous: T) => void): () => void;
}

export function createSignal<T = void>(initial?: T, onError?: (err: unknown) => void): Signal<T> {
  let current = initial as T;
  const listeners = new Set<(value: T, previous: T) => void>();
  return {
    get: () => current,
    emit(value) {
      const previous = current;
      current = value;
      for (const listener of [...listeners]) {
        if (!onError) { listener(value, previous); continue; }
        try { listener(value, previous); } catch (err) { onError(err); }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
