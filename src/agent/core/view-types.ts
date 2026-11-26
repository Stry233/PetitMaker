/** The panel's view of the session log: the types `deriveView` folds the log into. */
import type { CellBox, ToolFacts } from './tool-facts';
import type {
  ErrorClass, GateOption, JobOutcome, OrderRegion, PlanStage, ToolResultDetail,
} from './types';
import type { JobStopCause, SkillRef } from './types';

export type SessionPhase =
  | 'idle' | 'thinking' | 'streaming' | 'executing' | 'gated' | 'retrying'
  | 'pausing' | 'paused' | 'aborted' | 'incident';

/** What a session phase means for the loop and its job. */
export interface PhaseTraits {
  /** The job proceeds under its own power. */
  running: boolean;
  /** The loop still owns a job, including gates, retry backoff and a pending pause. */
  inFlight: boolean;
  /** No job is moving that Stop could reach. */
  atRest: boolean;
  /** The job is on hold and offers Resume. */
  onHold: boolean;
  /** Provider stream silence counts toward the stall notice; local tool execution does not. */
  awaitingStream: boolean;
  /** Pause is admitted: the job moves, so the loop grants one at its next step. Any other phase in flight admits only Stop. */
  pausable: boolean;
  /** The job waits on the user's answer or on a retry clock, where Stop reaches it with or without a loop. */
  waiting: boolean;
  /** The job waits on a clock alone, so a pause parks it there; under a gate a pause would hide the question. */
  parkable: boolean;
}

const NONE: PhaseTraits = {
  running: false, inFlight: false, atRest: false, onHold: false, awaitingStream: false,
  pausable: false, waiting: false, parkable: false,
};

export const PHASE_TRAITS: Readonly<Record<SessionPhase, PhaseTraits>> = {
  idle: { ...NONE, atRest: true },
  thinking: { ...NONE, running: true, inFlight: true, awaitingStream: true, pausable: true },
  streaming: { ...NONE, running: true, inFlight: true, awaitingStream: true, pausable: true },
  executing: { ...NONE, running: true, inFlight: true, pausable: true },
  gated: { ...NONE, inFlight: true, waiting: true },
  retrying: { ...NONE, inFlight: true, waiting: true, parkable: true },
  pausing: { ...NONE, inFlight: true },
  paused: { ...NONE, atRest: true, onHold: true },
  aborted: { ...NONE, atRest: true },
  incident: { ...NONE, atRest: true },
};

/** Whether a job in `phase` still owns the map: in flight, or held and resuming onto it. */
export function jobOwnsMap(phase: SessionPhase): boolean {
  return PHASE_TRAITS[phase].inFlight || PHASE_TRAITS[phase].onHold;
}

export interface OpRow {
  callId: string; name: string;
  /** Completed arguments support localized descriptions without parsing result prose. */
  input?: Record<string, unknown>;
  /** The cells the arguments name, as their bounding box, where they name a place. */
  footprint?: CellBox;
  /** Most recent undo checkpoint before the operation completed. */
  checkpointIndex?: number;
  /** `skipped` is a user decline; `cut` is a call left unresolved when its job ended. */
  status: 'run' | 'ok' | 'revert' | 'error' | 'blocked' | 'skipped' | 'cut' | 'words' | 'pending-gate';
  summary: string; detail?: ToolResultDetail; isRead: boolean;
  /** The plan stage the call is filed under: the one active when the log registered it, or the
   *  one being worked for a call still arriving. Absent on a job with no plan. */
  stageIndex?: number;
  /** A successful `load_skill`'s identity, for the op row's skill chip. */
  skill?: SkillRef;
  /** Rendered map shown to the model. Persisted logs omit the data URL. */
  image?: string;
}

/** UI verdict derived from a gate answer. A settled unanswered gate uses `unanswered`. */
export type GateVerdict = 'approved' | 'approved-always' | 'declined' | 'words' | 'unanswered';

/**
 * Reasoning digest for one turn. The assembler merges a turn's reasoning spans, and stream deltas
 * have no timestamps, so the turn is the finest durable unit for both content and elapsed time.
 */
export interface ThoughtTurn {
  /** The turn's own log seq: the mark's stable key across re-folds. */
  seq: number;
  /** The turn's span, in ms (see above). */
  ms: number;
  chars: number;
  /** Full live text or the persisted excerpt; absent when the provider exposes no text. */
  text?: string;
  /** Operation-list index before the turn's tool calls. */
  beforeIndex: number;
}

/** Persistent record of a supervision question and its eventual answer. */
export interface AskRecord {
  gateId: string;
  scope: 'tool' | 'plan';
  /** The ask's own sentence, logged in the locale it was asked in (never re-translated). */
  summary: string;
  callId?: string;
  /** Absent while the ask is still open. */
  verdict?: GateVerdict;
  /** The sentence a `words` answer carried: typed, or the offer that was taken. */
  words?: string;
  /** How a `words` answer was given: an option card taken (`picked`), a quick answer, or typed. */
  answeredBy?: 'option' | 'quick' | 'typed';
  /** The index of the option taken, where `answeredBy` is `option`. */
  picked?: number;
  /** Proposed stages carried by a gated `update_plan` call before approval. */
  stages?: PlanStage[];
  /** Quick answers offered with the question. */
  quickAnswers?: string[];
  /** Choice cards offered with the question. */
  options?: GateOption[];
}

export interface JobView {
  orderSeq: number; orderText: string;
  /** Timestamp used by the history record. */
  orderAt: number;
  /** Template ID stamped on the order. Missing IDs cannot pass the rollback map guard. */
  mapId?: string;
  /** Region attached to the order; the live composer region may later differ. */
  region?: OrderRegion;
  plan?: { stages: PlanStage[]; currentIndex: number; doneCount: number; revision: number };
  /** Every ask this job made, in the order it made them, each carrying its verdict once answered. */
  asks: AskRecord[];
  ops: OpRow[]; steerNotes: string[]; says?: string;
  /** The line shown for each of the user's notes or typed answers the content check refused. */
  refusals?: string[];
  /** The displayed response text is still streaming. */
  saysStreaming?: true;
  outcome?: JobOutcome; summary?: string;
  /** Error class from the incident that settled the job. */
  errorCls?: ErrorClass;
  checkpoints: { undoIndex: number; label: string; stageIndex?: number }[];
  /** Undo depth at settlement, paired with the first checkpoint to bound the job's writes. */
  endUndoIndex?: number;
  /** Why an aborted job stopped, where the user did not stop it (`types.ts:JobStopCause`). */
  stoppedBy?: JobStopCause;
  /** First occurrence of each side stamp, positioned among operation and thought rows. */
  stamps: { kind: 'compaction' | 'damper' | 'interrupted'; beforeIndex: number }[];
  /** Done-job classification: issued write, text-only answer, or no output. */
  kind?: 'build' | 'answer' | 'quiet';
  /** The model chose to end its closing text with a question. */
  question?: boolean;
  /** True for a completed, non-question job with at least one applied write. */
  celebrate: boolean;
  /**
   * Reasoning observed in committed and live turns. Character counts work across providers whose
   * token accounting differs; a turn may count without text when the provider hides its reasoning.
   */
  thought?: {
    chars: number;
    turns: number;
    /** Committed turns that thought, oldest first. */
    marks: readonly ThoughtTurn[];
    /** The committed turns' total span, in ms. */
    ms: number;
    /** What the turn still streaming has thought so far, where it is exposing the text. */
    live?: string;
  };
  /** Loaded skills in newest-use order, deduplicated by name. */
  skills: SkillRef[];
}

export interface PanelView {
  phase: SessionPhase;
  jobs: JobView[]; // settled, oldest first
  current?: JobView; // the running/paused job
  gate?: { gateId: string; scope: 'tool' | 'plan'; summary: string; callId?: string };
  queuedSteers: { seq: number; text: string }[];
  retry?: { attempt: number; cls: ErrorClass; delayMs: number; since: number };
  vitals: { cells: number; objects: number; reverts: number; jobs: number };
  /** Suggested composer text for the latest order, cleared when a new order starts. */
  suggestion: string | null;
  /** Timestamp of the last event in log order, or zero for an empty log. */
  lastEventAt: number;
  /** Present after a session-wide `allow-always` answer. */
  allowAll?: boolean;
}

/** The tool facts a projection reads: which ops are reads, and where a call's arguments point. */
export type ProjectionFacts = Pick<ToolFacts, 'access' | 'footprint'>;
