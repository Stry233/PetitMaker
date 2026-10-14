/* What each session phase means to the panel, as one table of traits. */
import type { SessionPhase } from '../../../agent/panel';
import type { PaperState } from '../panel-skin';
import type { I18nKey } from '../../../i18n/keys';

export interface PhaseTraits {
  /** The job proceeds under its own power. */
  running: boolean;
  /** The loop still owns a job, including gates, retry backoff and a pending pause; the desk clock ticks. */
  inFlight: boolean;
  /** No job is moving that Stop could reach. */
  atRest: boolean;
  /** The ticket's progress tape stands still. */
  frozen: boolean;
  /** The job is on hold and offers Resume. */
  onHold: boolean;
  /** Provider stream silence counts toward the stall notice; local tool execution does not. */
  awaitingStream: boolean;
  /** The desk card's paper. */
  paper: PaperState;
  /** The desk card's status word. Literal keys stay visible to the i18n drift check. */
  word: I18nKey;
}

const NONE = {
  running: false, inFlight: false, atRest: false, frozen: false, onHold: false, awaitingStream: false,
} as const;

export const PHASE: Record<SessionPhase, PhaseTraits> = {
  idle: { ...NONE, atRest: true, paper: 'idle', word: 'agent.dock_idle' },
  thinking: { ...NONE, running: true, inFlight: true, awaitingStream: true, paper: 'think', word: 'agent.dock_thinking' },
  streaming: { ...NONE, running: true, inFlight: true, awaitingStream: true, paper: 'think', word: 'agent.dock_writing' },
  executing: { ...NONE, running: true, inFlight: true, paper: 'work', word: 'agent.dock_executing' },
  gated: { ...NONE, inFlight: true, frozen: true, paper: 'ask', word: 'agent.dock_gated' },
  retrying: { ...NONE, inFlight: true, frozen: true, paper: 'wait', word: 'agent.dock_retry_again' },
  pausing: { ...NONE, inFlight: true, frozen: true, paper: 'work', word: 'agent.dock_pausing' },
  paused: { ...NONE, atRest: true, frozen: true, onHold: true, paper: 'wait', word: 'agent.dock_paused' },
  aborted: { ...NONE, atRest: true, paper: 'stop', word: 'agent.dock_aborted' },
  incident: { ...NONE, atRest: true, paper: 'danger', word: 'agent.dock_incident' },
};
