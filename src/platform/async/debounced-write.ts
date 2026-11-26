/**
 * A write owed after a quiet spell. A phone browser discards a hidden tab without another timer
 * tick, so what is owed is also written at once when the page is hidden (`visibilitychange`) or
 * left (`pagehide`, which Safari reports where it reports no hidden state when the page is replaced
 * or frozen); a page entering the back-forward cache hears it too, where the write is merely early.
 */
interface DebouncedWrite<T> {
  /** Owes a write of `value` in place of what was owed, made once `delayMs` pass with no newer one. */
  schedule(value: T): void;
  /** Writes what is owed now, if anything. */
  flush(): void;
  /** Forgets what is owed. */
  cancel(): void;
  /** Whether a write is owed. */
  owed(): boolean;
}

/** `write` gets the owed value and whether it runs as a flush, when the page may run no further
 *  task, so the write has to finish on this thread. The page listeners are bound on the first
 *  `schedule` and kept for the page's life. */
export function debouncedWrite<T>(delayMs: number, write: (value: T, flushing: boolean) => void): DebouncedWrite<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let bound = false;

  const take = (): { value: T } | null => {
    const owed = pending;
    pending = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    return owed;
  };
  const flush = (): void => {
    const owed = take();
    if (owed) write(owed.value, true);
  };
  const bind = (): void => {
    if (bound || typeof document === 'undefined') return;
    bound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  };

  return {
    schedule(value) {
      if (timer !== null) clearTimeout(timer);
      bind();
      pending = { value };
      timer = setTimeout(() => {
        const owed = take();
        if (owed) write(owed.value, false);
      }, delayMs);
    },
    flush,
    cancel: () => { take(); },
    owed: () => pending !== null,
  };
}
