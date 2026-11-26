/**
 * What the panel reads off the projected jobs: which job is owed, offered, opened or settled as a
 * card and which incident stands, the job's counts and its history by step, and the take-back rules. A take-back pops every
 * undo entry above its watermark, later manual edits or jobs included; taking a whole job back
 * rewinds to its first checkpoint, and a job whose first checkpoint the undo depth has fallen to is
 * rolled back. `takeBackStanding` is the one answer to whether a take-back may run: the verbs refuse
 * by it and the cards draw it.
 */
import { PROTOCOL } from './protocol';
import type { ErrorClass, JobOutcome } from './types';
import { PHASE_TRAITS, type JobView, type OpRow, type PanelView } from './view-types';

/** Which of the terminal family's cards a settled job earns. */
export type TerminalShape = 'paper' | 'stop' | 'receipt' | 'stalled';

/** Outcomes that keep a terminal card. */
const CARDED: ReadonlySet<JobOutcome> = new Set<JobOutcome>(['done', 'capped', 'aborted', 'incident']);

/** A job whose product is words rather than map edits. */
export function isAnswerJob(job: JobView): boolean {
  return job.kind === 'answer' || job.kind === 'quiet';
}

/** The newest unfiled settled job's card, unless a held offer of the same job replaces it. */
function terminal(
  view: PanelView, filed: ReadonlySet<number>, held?: JobView,
): { job: JobView; shape: TerminalShape } | null {
  if (view.current) return null;
  const job = view.jobs[view.jobs.length - 1];
  if (!job || job.outcome === undefined || !CARDED.has(job.outcome)) return null;
  if (filed.has(job.orderSeq)) return null;
  if (held !== undefined && job === held) return null;
  const shape: TerminalShape = job.outcome === 'aborted' ? 'stop'
    : job.outcome === 'incident' ? 'stalled'
      : isAnswerJob(job) ? 'paper' : 'receipt';
  return { job, shape };
}

/** The active incident's class and its job; -1 stands for an incident with no job. */
export function trouble(view: PanelView): { cls: ErrorClass; seq: number } | null {
  if (view.phase !== 'incident') return null;
  const last = view.jobs[view.jobs.length - 1];
  return { cls: last?.errorCls ?? 'unknown', seq: last?.orderSeq ?? -1 };
}

/** Whether the key went missing under a job that needed it: keyless while the job was in flight,
 *  held or stopped, or stalled on an authentication incident. */
export function keyGone(view: PanelView, connected: boolean, cls: ErrorClass | undefined): boolean {
  if (connected) return false;
  if (view.phase === 'incident') return cls === 'auth';
  return PHASE_TRAITS[view.phase].inFlight || view.phase === 'paused' || view.phase === 'aborted';
}

/**
 * How a refused key stands. A pasted key is replaced by hand (`key`). A key a sign-in returned is
 * replaced by signing in again (`sign-in-expired`), and once that has happened after the refused
 * order was sent, the order is free to be sent again (`signed-in-again`).
 */
export type KeyRefusal = 'key' | 'sign-in-expired' | 'signed-in-again';

/** `signedInAt`: when the held key came from a sign-in; `orderAt`: when the refused order was sent. */
export function keyRefusal(signedInAt: number | undefined, orderAt: number): KeyRefusal {
  if (signedInAt === undefined) return 'key';
  return signedInAt > orderAt ? 'signed-in-again' : 'sign-in-expired';
}

/** Why taking `job` back may not rewind this map: it ran on another map, or on one of unknown identity. */
export function rewindBlock(
  job: JobView, otherMap?: ReadonlySet<number>, unknownMap?: ReadonlySet<number>,
): 'other-map' | 'unknown-map' | undefined {
  return otherMap?.has(job.orderSeq) === true ? 'other-map' : unknownMap?.has(job.orderSeq) === true ? 'unknown-map' : undefined;
}

export interface StandingInputs {
  view: PanelView;
  connected: boolean;
  /** The past record the panel opened in place of the session, by its order seq. */
  openedSeq: number | null;
  filed: ReadonlySet<number>;
  cleared: ReadonlySet<number>;
  otherMap?: ReadonlySet<number>;
  unknownMap?: ReadonlySet<number>;
  /** The session is an untouched restoration. */
  restored: boolean;
  /** The incident the user demoted, by its job's order seq. */
  dismissed: number | null;
}

/** Where each job of the session stands. */
export interface JobStanding {
  /** The current job, or the newest settled one when the seat is empty. */
  owedJob?: JobView;
  /** A keyless session keeps its unfiled job and that job's repair in view. */
  keyCleared: boolean;
  incident: ReturnType<typeof trouble>;
  /** The incident is demoted to its standing strip. */
  standingTrouble: boolean;
  /** A restored pause offered for resumption, or a key-cleared job offered for repair. */
  offered?: JobView;
  /** An opened past record replacing the session. */
  opened?: JobView;
  /** The settled record standing as a card, and which card. */
  settled: { job: JobView; shape: TerminalShape } | null;
  /** The history, without the settled card, the offer and what was cleared. */
  past: readonly JobView[];
}

export function jobStanding(input: StandingInputs): JobStanding {
  const { view, connected, filed, cleared } = input;
  const owedJob = view.current ?? view.jobs[view.jobs.length - 1];
  const keyCleared = owedJob !== undefined && keyGone(view, connected, owedJob.errorCls) && !filed.has(owedJob.orderSeq);
  const incident = trouble(view);
  const offered = keyCleared
    ? (PHASE_TRAITS[view.phase].atRest ? owedJob : undefined)
    : input.restored && view.phase === 'paused' ? view.current : undefined;
  const opened = input.openedSeq === null || view.current ? undefined : view.jobs.find((job) => job.orderSeq === input.openedSeq);
  const settled = opened ? null : terminal(view, filed, offered);
  const past = view.jobs.filter((job) => job !== settled?.job && job !== offered && !cleared.has(job.orderSeq));
  return {
    ...(owedJob ? { owedJob } : {}),
    keyCleared,
    incident,
    standingTrouble: incident !== null && incident.seq === input.dismissed,
    ...(offered ? { offered } : {}),
    ...(opened ? { opened } : {}),
    settled,
    past,
  };
}

/** What a set of operations amounted to: the cells and objects their tool results report changed,
 *  and how many of them the executor classified as reads. */
interface OpTotals { cells: number; objects: number; reads: number }

function totalsOf(ops: readonly OpRow[]): OpTotals {
  const totals: OpTotals = { cells: 0, objects: 0, reads: 0 };
  for (const op of ops) {
    totals.cells += op.detail?.cells ?? 0;
    totals.objects += op.detail?.objects ?? 0;
    if (op.isRead) totals.reads += 1;
  }
  return totals;
}

/** The whole job's figures. */
export function jobTotals(job: JobView): OpTotals {
  return totalsOf(job.ops);
}

/** The figures of the plan stage at `index`: the operations the projection filed under it. */
export function stageTotals(job: JobView, index: number): OpTotals {
  return totalsOf(job.ops.filter((op) => op.stageIndex === index));
}

/** Cells and objects changed, as reported by the job's tool results. */
export function editCount(job: JobView): number {
  const { cells, objects } = jobTotals(job);
  return cells + objects;
}

/** Operations the executor classified as reads. */
export function readCount(job: JobView): number {
  return jobTotals(job).reads;
}

/** Conversation controls do not describe work performed on or inspected in the map. */
const HIDDEN_CONTROLS = new Set<string>([PROTOCOL.plan, PROTOCOL.reply]);

/** The job's operations on the map, those before its first checkpoint and those of each step. */
export function buildHistory(job: JobView): { before: OpRow[]; steps: OpRow[][]; count: number } {
  const before: OpRow[] = [];
  const steps = job.checkpoints.map(() => [] as OpRow[]);
  let count = 0;
  for (const op of job.ops) {
    if (HIDDEN_CONTROLS.has(op.name)) continue;
    count++;
    const index = op.checkpointIndex;
    const group = index === undefined ? undefined : steps[index];
    (group ?? before).push(op);
  }
  return { before, steps, count };
}

/** The undo watermark taking the whole job back rewinds to: its first checkpoint's, or null where
 *  it recorded none. */
function takeBackPoint(job: JobView): number | null {
  return job.checkpoints[0]?.undoIndex ?? null;
}

/** Settled jobs whose first checkpoint is at or above the current undo depth. */
export function rolledBackSeqs(jobs: readonly JobView[], undoDepth: number | undefined): ReadonlySet<number> {
  if (undoDepth === undefined) return new Set();
  const out = new Set<number>();
  for (const job of jobs) {
    const at = takeBackPoint(job);
    if (at !== null && undoDepth <= at) out.add(job.orderSeq);
  }
  return out;
}

/** What one take-back press would cost, in undo entries. */
export interface RollbackCost {
  /** Every entry the press pops. */
  steps: number;
  /**
   * How many of those were laid down after the job settled: the user's own later work, or a later
   * job's. Absent means unknowable (a record with no settle depth), never zero.
   */
  mine?: number;
}

/**
 * What popping to `watermark` would cost, or null where the live depth is unknown (no map open, a
 * caller that reads none) and the panel therefore has no number to state.
 *
 * `jobTop` is the job's own settle depth (`JobView.endUndoIndex`).
 */
export function rollbackCost(
  watermark: number,
  depth: number | undefined,
  jobTop?: number,
): RollbackCost | null {
  if (depth === undefined) return null;
  const steps = Math.max(0, depth - watermark);
  if (jobTop === undefined) return { steps };
  return { steps, mine: Math.max(0, depth - Math.max(jobTop, watermark)) };
}

/** Whether a press aimed at `watermark` would take anything off the map at all. A rewind that pops
 *  nothing is not a take-back, and offering one is a control that does nothing. */
function rollbackReaches(watermark: number, depth: number | undefined): boolean {
  return depth === undefined || depth > watermark;
}

/** The live facts a take-back is read against. */
export interface TakeBackFacts {
  /** A job is in flight, writing the undo stack a take-back would pop. */
  running: boolean;
  /** The open map's undo depth; absent where no map is open or the reader holds none. */
  undoDepth?: number;
  /** Records made on another map, by order seq. */
  otherMap?: ReadonlySet<number>;
  /** Records whose map cannot be told, by order seq. */
  unknownMap?: ReadonlySet<number>;
}

/**
 * Why a take-back may not run. A record of another map or of none it can name never rewinds this
 * one; `nothing` is a job with no such checkpoint or one whose press would pop no entry; `busy`
 * stands only over a take-back that could otherwise run, and lifts when the job holds or ends.
 */
export type TakeBackRefusal = 'other-map' | 'unknown-map' | 'nothing' | 'busy';

/** Where a take-back rewinds to and what it costs, or why it is refused. */
export type TakeBackStanding =
  | { at: number; cost: RollbackCost | null; refused?: undefined }
  | { refused: TakeBackRefusal };

/**
 * How taking `job` back stands: the whole of it (`'whole'`, to its first checkpoint) or back to the
 * checkpoint at index `to`. A whole take-back prices the user's later work against the job's settle
 * depth, as a settled record's step does; a live job has none.
 */
export function takeBackStanding(job: JobView, to: number | 'whole', facts: TakeBackFacts): TakeBackStanding {
  const blocked = rewindBlock(job, facts.otherMap, facts.unknownMap);
  if (blocked) return { refused: blocked };
  const at = to === 'whole' ? takeBackPoint(job) : job.checkpoints[to]?.undoIndex ?? null;
  if (at === null || !rollbackReaches(at, facts.undoDepth)) return { refused: 'nothing' };
  if (facts.running) return { refused: 'busy' };
  return { at, cost: rollbackCost(at, facts.undoDepth, job.endUndoIndex) };
}
