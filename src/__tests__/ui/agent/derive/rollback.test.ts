/**
 * The words every take-back in the panel asks with: what a press costs and which part of that cost
 * was never the job's (the numbers are `__tests__/agent/core/job-readings.test.ts`).
 *
 * `t` is stubbed rather than run through `I18nProvider`: what matters here is which key is chosen
 * and which params reach it, and a stub says both in one string.
 */
import { describe, it, expect } from 'vitest';
import { rewindConfirmCopy } from '../../../../ui/agent/derive/rollback';
import { rollbackCost } from '../../../../agent/core/job-readings';
import { translateFor } from '../../../../i18n/context';
import type { TextKey } from '../../../../i18n/keys';

/** Reports the key and its params verbatim, so a test can read the choice off the result. */
function t(key: string, params?: Record<string, string | number>): string {
  return params ? `${key}(${JSON.stringify(params)})` : key;
}

describe('rewindConfirmCopy: the confirm names the size, and names whose it is', () => {
  it('names BOTH numbers when the user has laid work on top', () => {
    const copy = rewindConfirmCopy(t, { steps: 16, mine: 12 });
    expect(copy.confirmLabel).toBe(`agent.rewind_q_mine(${JSON.stringify({ n: 16, mine: 'agent.rewind_mine_q_part({"n":12})' })})`);
    expect(copy.question).toBe(`agent.rewind_cost_mine(${JSON.stringify({ n: 16, mine: 'agent.rewind_mine_part({"n":12})' })})`);
  });

  it('agrees each number with its own noun', () => {
    const ru = (key: TextKey, params?: Record<string, string | number>) => translateFor('ru', key, params);
    expect(rewindConfirmCopy(ru, { steps: 3, mine: 1 }).question).toBe('Будут отменены 3 шага на карте, из них 1 сделан вами после этой задачи.');
    expect(rewindConfirmCopy(ru, { steps: 5, mine: 2 }).confirmLabel).toBe('Отменить 5 шагов, из них 2 ваших?');
    const fr = (key: TextKey, params?: Record<string, string | number>) => translateFor('fr', key, params);
    expect(rewindConfirmCopy(fr, { steps: 4, mine: 1 }).question).toBe('Annule 4 étapes sur votre carte, dont 1 faite par vous après cette tâche.');
  });

  it('names the total alone when nothing of the user\'s stands above the job', () => {
    const copy = rewindConfirmCopy(t, { steps: 4, mine: 0 });
    expect(copy.confirmLabel).toBe('agent.rewind_q({"n":4})');
    expect(copy.question).toBe('agent.rewind_cost({"n":4})');
  });

  it('names the total HONESTLY where the split cannot be proven', () => {
    const copy = rewindConfirmCopy(t, { steps: 16 });
    expect(copy.confirmLabel).toBe('agent.rewind_q({"n":16})');
  });

  it('passes a single step as a count, so the table picks its singular', () => {
    expect(rewindConfirmCopy(t, { steps: 1, mine: 0 }).confirmLabel).toBe('agent.rewind_q({"n":1})');
    expect(rewindConfirmCopy(t, { steps: 1, mine: 0 }).question).toBe('agent.rewind_cost({"n":1})');
  });

  it('falls back to the unnumbered question where there is no depth to state', () => {
    expect(rewindConfirmCopy(t, null).confirmLabel).toBe('agent.ticket_rewind_all_q');
  });

  /** One step popped with the user's own edit in it reads the exact-one wording, never "1 steps". */
  it('reads its singular through the mine branch too', () => {
    expect(rollbackCost(7, 8, 7)).toEqual({ steps: 1, mine: 1 });
    const copy = rewindConfirmCopy((key, params) => translateFor('en', key, params), { steps: 1, mine: 1 });
    expect(copy.confirmLabel).toBe(translateFor('en', 'agent.rewind_q_mine_single'));
    expect(copy.question).toBe(translateFor('en', 'agent.rewind_cost_mine_single'));
  });
});
