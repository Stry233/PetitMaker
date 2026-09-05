/**
 * Converts a stalled provider stream into a retryable timeout. The first event has a longer bound
 * because models with hidden reasoning may remain silent while working; later events use a shorter gap.
 */
import type { StreamEvent, TurnError } from './types';

/** Maximum wait before the first stream event, in milliseconds. */
export const FIRST_EVENT_IDLE_MS = 300_000;
/** Between events, once the stream has proven alive. */
export const BETWEEN_EVENT_IDLE_MS = 120_000;

/** Produces the network-class timeout shared with SDK connection timeouts. */
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
