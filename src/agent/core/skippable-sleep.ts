/** A `sleep` whose wait can be ended by hand: the runner's retry ladder is the ONE caller
 *  (`loop.ts`'s `deps.sleep`, only at the backoff between adapter attempts — never the idle-stream
 *  bound or the summary bound, which are their own separate timers), and the panel's retry
 *  countdown press needs to resolve that wait immediately without touching the clock. `skip()` is
 *  not latched: it only ever resolves sleeps already pending at the moment it runs, so a sleep
 *  started afterward (the NEXT attempt's own backoff) waits out its full delay. */
export interface SkippableSleeper {
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  skip(): void;
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('The wait was aborted.', 'AbortError');
  const err = new Error('The wait was aborted.');
  err.name = 'AbortError';
  return err;
}

export function createSkippableSleeper(): SkippableSleeper {
  const pending = new Set<() => void>();
  return {
    sleep(ms: number, signal: AbortSignal): Promise<void> {
      if (signal.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => {
        const settle = (fn: () => void): void => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); pending.delete(done); fn(); };
        // A caller's OWN abort listener on this signal can run `skip()` (via `done`) before the
        // sleeper's own `onAbort` fires, if it was registered first — listeners run in
        // registration order, and `signal.aborted` is already true by then. Guarding here (rather
        // than trusting whichever listener runs first) keeps a skip that races an abort a
        // rejection, never a silent success.
        const done = (): void => settle(signal.aborted ? () => reject(abortError()) : resolve);
        const onAbort = (): void => settle(() => reject(abortError()));
        const timer = setTimeout(done, ms);
        pending.add(done);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    skip(): void { for (const done of [...pending]) done(); },
  };
}
