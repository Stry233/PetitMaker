/*
 * The harness's published limits (turn budgets, retries, stream deadlines) for surfaces that
 * describe the assistant without loading it, Help among them. Core modules only: an edition that
 * ships no assistant may still read these.
 */
export { MAX_TURNS_DEFAULT, SUBAGENT_MAX_TURNS } from './core/governor';
export { MAX_TURN_ATTEMPTS } from './core/retry';
export { BETWEEN_EVENT_IDLE_MS, FIRST_EVENT_IDLE_MS } from './core/stream-idle';
