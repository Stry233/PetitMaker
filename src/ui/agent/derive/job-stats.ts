import type { JobView } from '../../../agent/panel';

/** Cells and objects changed, as reported by the job's tool results. */
export function editCount(job: JobView): number {
  return job.ops.reduce((sum, op) => sum + (op.detail?.cells ?? 0) + (op.detail?.objects ?? 0), 0);
}

/** Operations the executor classified as reads. */
export function readCount(job: JobView): number {
  return job.ops.filter((op) => op.isRead).length;
}
