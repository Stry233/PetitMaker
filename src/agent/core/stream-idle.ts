/** A bound on a stream that has stopped talking without ending.
 *
 *  An adapter's generator only finishes when the provider closes the response, so a dropped socket
 *  a proxy never tears down, a gateway holding the connection open, or a model that stalls mid-turn
 *  leaves the loop awaiting a `next()` that resolves at no point in the future: the job freezes with
 *  no error, no incident and no end, which is what the panel reads as a run standing still forever.
 *  This wrapper races each `next()` against a clock and turns the stall into an error VALUE, so it
 *  travels the retry ladder every other transient fault already uses rather than growing a second
 *  recovery path of its own.
 *
 *  THE BOUND IS NOT ONE NUMBER, because silence before the first event means something different
 *  from silence after it. A hidden-CoT model (the o-series, and every provider whose reasoning we
 *  never see) can legitimately think for minutes and send nothing at all in that time, so a flat
 *  30-60s cut would kill a working turn; once an event HAS arrived the stream has proven itself and
 *  a much shorter bound is honest. Both are deliberately far above any real inter-token gap: this
 *  answers a stream that is DEAD, never one that is slow. */
import type { StreamEvent, TurnError } from './types';

/** Before the FIRST event: generous, because a turn that is thinking sends nothing while it does. */
export const FIRST_EVENT_IDLE_MS = 300_000;
/** Between events, once the stream has proven alive. */
export const BETWEEN_EVENT_IDLE_MS = 120_000;

/** `network`, so the class the banner captions and the retry ladder reads is the one the user's
 *  actual trouble is: the connection stopped carrying anything. The wording matches the timeout
 *  pattern `errors.ts` classifies, which is where the SDK's own `APIConnectionTimeoutError` lands. */
function idleError(ms: number): TurnError {
  return { cls: 'network', detail: `The provider sent nothing for ${Math.round(ms / 1000)}s; the request timed out.` };
}

export function withIdleTimeout(
  stream: AsyncGenerator<StreamEvent>,
  opts: { firstMs?: number; betweenMs?: number; onIdle?: () => void } = {},
): AsyncGenerator<StreamEvent> {
  const firstMs = opts.firstMs ?? FIRST_EVENT_IDLE_MS;
  const betweenMs = opts.betweenMs ?? BETWEEN_EVENT_IDLE_MS;
  return (async function* run(): AsyncGenerator<StreamEvent> {
    let alive = false;
    for (;;) {
      const ms = alive ? betweenMs : firstMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<'idle'>((resolve) => { timer = setTimeout(() => resolve('idle'), ms); });
      let step: IteratorResult<StreamEvent> | 'idle';
      try {
        // The losing `next()` is left dangling on purpose: it may never settle, and `Promise.race`
        // has already attached handlers to it, so a late rejection cannot surface as unhandled.
        step = await Promise.race([stream.next(), idle]);
      } finally {
        clearTimeout(timer);
      }
      if (step === 'idle') {
        opts.onIdle?.();
        // Fire-and-forget: an async generator queues `return()` behind the pending `next()`, so
        // awaiting it here would hang on exactly the stall being escaped.
        void Promise.resolve(stream.return?.(undefined)).catch(() => {});
        yield { t: 'error', error: idleError(ms) };
        return;
      }
      if (step.done) return;
      alive = true;
      yield step.value;
    }
  })();
}
