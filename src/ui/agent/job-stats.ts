import type { JobView } from '../../agent/core/project-view';

/** Cells and objects changed, as reported by the job's tool results. */
export function editCount(job: JobView): number {
  return job.ops.reduce((sum, op) => sum + (op.detail?.cells ?? 0) + (op.detail?.objects ?? 0), 0);
}
