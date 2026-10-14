/* Which settled record stands as a card, and the facts the job zone reads off the record list. */
import type { ErrorClass, JobOutcome, JobView, PanelView } from '../../../agent/panel';
import { fmtClock } from './clock';

/** Which of the terminal family's cards a settled job earns. */
export type TerminalShape = 'paper' | 'stop' | 'receipt' | 'stalled';

/** Outcomes that keep a terminal card. */
const CARDED: ReadonlySet<JobOutcome> = new Set<JobOutcome>(['done', 'capped', 'aborted', 'incident']);

/** A job whose product is words rather than map edits. */
export function isAnswerJob(job: JobView): boolean {
  return job.kind === 'answer' || job.kind === 'quiet';
}

/** The newest unfiled settled job's card, unless a held offer of the same job replaces it. */
export function terminal(
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

/** Settled jobs whose first checkpoint is at or above the current undo depth. */
export function rolledBackSeqs(jobs: readonly JobView[], undoDepth: number | undefined): ReadonlySet<number> {
  if (undoDepth === undefined) return new Set();
  const out = new Set<number>();
  for (const job of jobs) {
    const first = job.checkpoints[0];
    if (first !== undefined && undoDepth <= first.undoIndex) out.add(job.orderSeq);
  }
  return out;
}

/** Duration from the job's order to the session's final recorded event. */
export function clockOf(view: PanelView, job: JobView): string | null {
  return fmtClock((view.lastEventAt - job.orderAt) / 1000);
}

/** The active incident's class and its job; -1 stands for an incident with no job. */
export function trouble(view: PanelView): { cls: ErrorClass; seq: number } | null {
  if (view.phase !== 'incident') return null;
  const last = view.jobs[view.jobs.length - 1];
  return { cls: last?.errorCls ?? 'unknown', seq: last?.orderSeq ?? -1 };
}
