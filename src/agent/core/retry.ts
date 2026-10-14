import type { SessionEvent } from './types';
import type { TurnError } from './types';

/** A turn gets at most this many adapter attempts in total (the initial call plus retries) before
 *  the harness gives up and surfaces an incident: at 5, that is 4 `retry` events followed by the
 *  5th attempt's failure landing the incident directly, never a 5th retry. */
export const MAX_TURN_ATTEMPTS = 5;

const BASE_MS = 1000;
const CAP_MS = 30000;

/** The longest a provider's `Retry-After` may hold a retry: one per-minute quota window. A longer
 *  wait leaves the job looking hung, and the next attempt's refusal reports the outage instead. */
const RETRY_AFTER_MAX_MS = 60_000;

/** The wait before retry `attempt` (1-based). A provider's own `Retry-After` (`retryAfterMs`) is
 *  honored up to `RETRY_AFTER_MAX_MS`, since it is the provider naming the window itself; otherwise
 *  an exponential backoff capped at 30s is jittered down to [0.75, 1] of its value so a burst of
 *  turns failing at once (a shared-key rate limit, an outage) doesn't retry in lockstep. */
export function retryDelayMs(attempt: number, err: TurnError, rand: () => number = Math.random): number {
  if (err.retryAfterMs !== undefined) return Math.min(Math.max(err.retryAfterMs, 0), RETRY_AFTER_MAX_MS);
  const base = Math.min(BASE_MS * 2 ** attempt, CAP_MS);
  return base * (0.75 + 0.25 * rand());
}

/** The least a paced session waits between turns, in ms: at most twenty requests a minute, the
 *  budget of the free tiers a shared-budget refusal arrives from. */
const PACE_DEFAULT_MS = 3000;
/** The most the pace may be, whatever the provider asked for: a `Retry-After` is a wait before one
 *  more attempt, which the retry ladder honours, not a gap for every later turn. */
const PACE_MAX_MS = 15000;

/**
 * The gap kept between this session's requests, in ms, or 0 before any rate limit. From the first
 * rate-limit retry on, it is the widest wait the session has served, clamped to the default and the
 * cap. Read off the log, so a reload keeps the pace, and session-wide, like a per-minute budget.
 */
export function pacingFloorMs(events: readonly SessionEvent[]): number {
  let floor = 0;
  for (const e of events) {
    if (e.kind !== 'retry' || e.cls !== 'rate-limit') continue;
    floor = Math.max(floor, Math.min(Math.max(e.delayMs, PACE_DEFAULT_MS), PACE_MAX_MS));
  }
  return floor;
}
