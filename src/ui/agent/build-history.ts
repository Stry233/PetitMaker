import type { JobView, OpRow } from '../../agent/core/project-view';

/** Conversation controls do not describe work performed on or inspected in the map. */
const HIDDEN_CONTROLS = new Set(['update_plan', 'suggest_reply']);

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
