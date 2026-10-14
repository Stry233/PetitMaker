/** The session phase folded from the log's phase markers, shared by `derivePhase` and `deriveView`. */
import type { SessionLog } from './log';
import { eventsOf } from './log';
import type { SessionEvent } from './types';
import type { SessionPhase } from './view-types';

type GateAskedEvent = Extract<SessionEvent, { kind: 'gateAsked' }>;
type RetryEvent = Extract<SessionEvent, { kind: 'retry' }>;

/** What the session phase is folded from: the phase markers, whether a job is open, and its open gate and retry. */
export interface PhaseFold {
  phase: SessionPhase;
  inJob: boolean;
  openGate?: GateAskedEvent;
  openRetry?: RetryEvent;
}

export function phaseStep(f: PhaseFold, e: SessionEvent): void {
  switch (e.kind) {
    case 'order':
      f.inJob = true;
      f.phase = 'thinking';
      f.openRetry = undefined;
      break;
    case 'assistant':
      if (f.inJob) f.phase = 'thinking';
      f.openRetry = undefined;
      break;
    case 'gateAsked':
      f.openGate = e;
      break;
    case 'gateAnswered':
      if (f.openGate?.gateId === e.gateId) f.openGate = undefined;
      break;
    case 'pauseRequested':
      f.phase = 'pausing';
      break;
    // Pausing ends the active retry timer; resume starts from thinking state.
    case 'paused':
      f.phase = 'paused';
      f.openRetry = undefined;
      break;
    case 'resumed':
      f.phase = f.inJob ? 'thinking' : 'idle';
      f.openRetry = undefined;
      break;
    case 'retry':
      f.openRetry = e;
      break;
    // Settlement clears gates and retries owned by the ended job.
    case 'incident':
      f.inJob = false;
      f.openGate = undefined;
      f.openRetry = undefined;
      f.phase = 'incident';
      break;
    case 'jobEnd':
      f.inJob = false;
      f.openGate = undefined;
      f.openRetry = undefined;
      f.phase = e.outcome === 'incident' ? 'incident' : e.outcome === 'aborted' ? 'aborted' : 'idle';
      break;
    default:
      break;
  }
}

/** The folded phase with precedence applied: open gates outrank retries, and a pause suppresses both. */
export function foldedPhase(f: PhaseFold): SessionPhase {
  if (f.inJob && f.phase !== 'paused' && f.phase !== 'pausing') {
    if (f.openGate) return 'gated';
    if (f.openRetry) return 'retrying';
  }
  return f.phase;
}

/** The session phase alone, without live parts: the fold `deriveView` runs, reading phase markers only. */
export function derivePhase(log: SessionLog): SessionPhase {
  const f: PhaseFold = { phase: 'idle', inJob: false };
  for (const e of eventsOf(log)) phaseStep(f, e);
  return foldedPhase(f);
}
