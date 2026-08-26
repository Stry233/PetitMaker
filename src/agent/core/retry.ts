import type { SessionEvent } from './types';
import type { TurnError } from './types';

/** A turn gets at most this many ADAPTER ATTEMPTS in total (the initial call plus retries) before
 *  the harness gives up and surfaces an incident: at 5, that is 4 `retry` events followed by the
 *  5th attempt's failure landing the incident directly, never a 5th retry. */
export const MAX_TURN_RETRIES = 5;

const BASE_MS = 1000;
const CAP_MS = 30000;

/** The wait before retry `attempt` (1-based). A provider's own `Retry-After` (`retryAfterMs`) is
 *  honored verbatim, since it is the provider naming the exact window itself; otherwise an
 *  exponential backoff capped at 30s is jittered down to [0.75, 1] of its value so a burst of
 *  turns failing at once (a shared-key rate limit, an outage) doesn't retry in lockstep. */
export function retryDelayMs(attempt: number, err: TurnError, rand: () => number = Math.random): number {
  if (err.retryAfterMs !== undefined) return err.retryAfterMs;
  const base = Math.min(BASE_MS * 2 ** attempt, CAP_MS);
  return base * (0.75 + 0.25 * rand());
}

/** The least a paced session waits between turns: three seconds, a request every twenty of them,
 *  which is the shape of the free tiers a shared-budget refusal arrives from. */
const PACE_DEFAULT_MS = 3000;
/** The most the pace may be, whatever the provider asked for. A `Retry-After` is a wait before ONE
 *  more attempt; read as the gap between every turn of a forty-turn job it would be minutes of
 *  standing still, and the retry ladder is what honours a long refusal properly. */
const PACE_MAX_MS = 15000;

/**
 * HOW FAR APART THIS SESSION'S REQUESTS ARE KEPT, in ms, or 0 while nothing has asked for spacing.
 *
 * No pacing until an endpoint has actually refused once: a local model answering in 200ms must stay
 * that fast, and a courtesy nobody asked for is a slower panel for every user. From the first
 * rate-limit on, the widest wait the session has already served is the gap it keeps between turns,
 * never under the default and never over the cap — the courtesy the ladder cannot provide, since a
 * ladder only ever acts after the refusal it is answering.
 *
 * READ OFF THE LOG, like every other counter the loop keeps, so a reload resumes at the pace the
 * session had already learned. Session-wide rather than job-scoped, because a per-minute budget is.
 */
export function pacingFloorMs(events: readonly SessionEvent[]): number {
  let floor = 0;
  for (const e of events) {
    if (e.kind !== 'retry' || e.cls !== 'rate-limit') continue;
    floor = Math.max(floor, Math.min(Math.max(e.delayMs, PACE_DEFAULT_MS), PACE_MAX_MS));
  }
  return floor;
}
