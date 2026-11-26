/*
 * How every assistant take-back control stands and what it asks before it acts. Whether it may run
 * and its cost are `agent/panel.ts:takeBackStanding`'s: `mine` counts entries above the recorded job
 * end when that depth is known, otherwise the question states only the total.
 */
import type { Translate } from '../../../i18n/keys';
import type { RollbackCost, TakeBackFacts, TakeBackStanding } from '../../../agent/panel';

/** The facts of a card drawn outside a session: no job in flight, no live depth, no other map. */
export const AT_REST: TakeBackFacts = { running: false };

/** A take-back control as its card draws it: held while a job runs, with the reason readable, or
 *  ready with what the press costs; null where the take-back is refused for good and has no control. */
export function takeBackControl(standing: TakeBackStanding): { busy: boolean; cost: RollbackCost | null } | null {
  if (standing.refused === undefined) return { busy: false, cost: standing.cost };
  return standing.refused === 'busy' ? { busy: true, cost: null } : null;
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
