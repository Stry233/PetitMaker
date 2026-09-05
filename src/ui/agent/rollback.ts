/*
 * Shared rollback accounting for every assistant take-back control. A rollback pops all undo entries
 * above its watermark, including later manual edits or jobs. `mine` identifies entries above the
 * recorded job end when that depth is known; otherwise confirmation reports only the total. Controls
 * for another or unknown map are omitted, while a running job temporarily disables them.
 */

/** What one take-back press would cost, in undo entries. */
export interface RollbackCost {
  /** Every entry the press pops. */
  steps: number;
  /**
   * How many of those were laid down AFTER the job settled — the user's own later work, or a later
   * job's. Absent means UNKNOWABLE (a record with no settle depth), never zero.
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
export function rollbackReaches(watermark: number, depth: number | undefined): boolean {
  return depth === undefined || depth > watermark;
}

/** Confirmation copy for a take-back. The visible pill and screen-reader label both state its size
 *  and separately identify later work when the record can prove there is any. */
export function rewindConfirmCopy(
  t: (key: string, params?: Record<string, string | number>) => string,
  cost: RollbackCost | null,
): { question: string; confirmLabel: string } {
  if (cost === null) {
    const fallback = t('agent3.ticket_rewind_all_q');
    return { question: fallback, confirmLabel: fallback };
  }
  if (cost.mine !== undefined && cost.mine > 0) {
    // THE SINGULAR HAS TO SURVIVE THIS BRANCH. It is tested before the one-step case, so a press
    // that pops exactly one entry read "Rewind 1 steps, 1 yours?" — and fr's participle agreed with
    // a plural that was not there. `mine` can never exceed `steps` (`rollbackCost` measures both
    // from the same depth), so one step means the one is the user's and both figures are the same 1.
    if (cost.steps === 1) {
      return {
        question: t('agent3.rewind_cost_mine_one'),
        confirmLabel: t('agent3.rewind_q_mine_one'),
      };
    }
    return {
      question: t('agent3.rewind_cost_mine', { n: cost.steps, mine: cost.mine }),
      confirmLabel: t('agent3.rewind_q_mine', { n: cost.steps, mine: cost.mine }),
    };
  }
  if (cost.steps === 1) {
    return { question: t('agent3.rewind_cost_one'), confirmLabel: t('agent3.rewind_q_one') };
  }
  return {
    question: t('agent3.rewind_cost', { n: cost.steps }),
    confirmLabel: t('agent3.rewind_q', { n: cost.steps }),
  };
}
