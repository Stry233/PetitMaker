/*
 * rollback.ts — ONE SAFETY MODEL for every take-back the panel offers, and the only place that
 * model is written down.
 *
 * Four verbs point at the same undo stack: the history row's roll back, the receipt's Rewind to
 * start, the receipt's per-step rewind, and the live ticket's per-stage one. They were four separate
 * presses with four different amounts of care, which is how one of them came to destroy a dozen
 * hand edits without saying so. What they share is stated here, once:
 *
 * A TAKE-BACK POPS THE OPEN MAP'S UNDO STACK DOWN TO A DEPTH, and everything standing above that
 * depth goes, whoever put it there. So the cost is not "the job's edits" — it is every entry above
 * the watermark, and the honest confirm names it.
 *
 * WHOSE ENTRIES THOSE ARE is knowable from the log alone: a job's first `checkpoint` banks the depth
 * before it wrote anything and its `jobEnd` banks the depth it settled at, so anything above the
 * settle depth was laid down AFTER the job — the user's own work, or a later job's. `mine` is that
 * count. A log written before `jobEnd.undoIndex` existed cannot answer it, and there the confirm
 * names the TOTAL rather than guessing at a split: an unprovable division is worse than none.
 *
 * TWO REFUSALS, TWO TREATMENTS, and the difference is whether the refusal will ever lift:
 *
 *   MAP     (`other-map` / `unknown-map`) — permanent for this record on this map. The control is
 *           ABSENT and a standing notice over the record says why. Handled by the caller's own
 *           `otherMap`/`unknownMap` sets; nothing here decides it.
 *   RUNNING — temporary, and the control must not move under the hand that is about to press it. So
 *           it stands DISABLED with its reason readable, per the interface's layout-stability rule.
 *
 * THE PANEL NEVER REFUSES A TAKE-BACK BECAUSE THE USER'S OWN WORK DOMINATES IT. Naming the cost is
 * the whole answer: it is the user's map, the alternative route (Ctrl+Z) is theirs anyway, and a
 * refusal here would be the panel overruling a deliberate, confirmed press on the grounds that the
 * user had been busy.
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

/** The words a take-back's confirm stands behind: the pill the user presses, and the sentence a
 *  screen reader is given. Both name the SIZE — the artifact's own rule for a destructive press —
 *  and both name the user's later work separately wherever the record can prove there is any. */
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
