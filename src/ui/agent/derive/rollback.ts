import type { Translate } from '../../../i18n/keys';
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
   * How many of those were laid down after the job settled — the user's own later work, or a later
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
export function rollbackReaches(watermark: number, depth: number | undefined): boolean {
  return depth === undefined || depth > watermark;
}

/** Confirmation copy for a take-back. The visible pill and screen-reader label both state its size
 *  and separately identify later work when the record can prove there is any. */
export function rewindConfirmCopy(
  t: Translate,
  cost: RollbackCost | null,
): { question: string; confirmLabel: string } {
  if (cost === null) {
    const fallback = t('agent.ticket_rewind_all_q');
    return { question: fallback, confirmLabel: fallback };
  }
  if (cost.mine !== undefined && cost.mine > 0) {
    // `mine` never exceeds `steps` (`rollbackCost` measures both from the same depth), so the
    // exact-one wording `_single` that one step selects can say the one step is the user's.
    return {
      question: t('agent.rewind_cost_mine', { n: cost.steps, mine: t('agent.rewind_mine_part', { n: cost.mine }) }),
      confirmLabel: t('agent.rewind_q_mine', { n: cost.steps, mine: t('agent.rewind_mine_q_part', { n: cost.mine }) }),
    };
  }
  return {
    question: t('agent.rewind_cost', { n: cost.steps }),
    confirmLabel: t('agent.rewind_q', { n: cost.steps }),
  };
}
