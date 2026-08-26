/**
 * rollback.test.ts — THE ONE SAFETY MODEL every take-back in the panel reads.
 *
 * The defect this pins: "Rewind to start" popped the undo stack down to a DEPTH and took the user's
 * own later edits with it, saying nothing. The model's whole job is to state what a press costs and
 * to say which part of that cost was never the job's — so these tests are about the NUMBERS and the
 * WORDS, not about any card.
 *
 * `t` is stubbed rather than run through `I18nProvider`: what matters here is which key is chosen
 * and which params reach it, and a stub says both in one string.
 */
import { describe, it, expect } from 'vitest';
import { rewindConfirmCopy, rollbackCost, rollbackReaches } from '../../../ui/agent/rollback';

/** Reports the key and its params verbatim, so a test can read the choice off the result. */
function t(key: string, params?: Record<string, string | number>): string {
  return params ? `${key}(${JSON.stringify(params)})` : key;
}

describe('rollbackCost: what a press would pop', () => {
  it('counts every entry above the watermark, not the job\'s own edits', () => {
    // The job wrote 4 (depth 3 -> 7), and the user then laid 12 by hand.
    expect(rollbackCost(3, 19, 7)).toEqual({ steps: 16, mine: 12 });
  });

  it('reports no later work of the user\'s where the map has not moved since the job', () => {
    expect(rollbackCost(3, 7, 7)).toEqual({ steps: 4, mine: 0 });
  });

  it('leaves the split UNKNOWN rather than guessing where the record banked no settle depth', () => {
    const cost = rollbackCost(3, 19);
    expect(cost).toEqual({ steps: 16 });
    expect(cost?.mine).toBeUndefined();
  });

  it('answers nothing at all where the live depth is unknown', () => {
    expect(rollbackCost(3, undefined, 7)).toBeNull();
  });

  it('measures a MID-JOB watermark against the same settle depth', () => {
    // Rewinding to the job's second checkpoint (depth 5) with 12 later hand edits standing.
    expect(rollbackCost(5, 19, 7)).toEqual({ steps: 14, mine: 12 });
  });

  it('never reports a negative count when the stack already stands below the watermark', () => {
    expect(rollbackCost(7, 3, 9)).toEqual({ steps: 0, mine: 0 });
  });
});

describe('rollbackReaches: a press that would pop nothing is not a take-back', () => {
  it('is false once the stack stands at or below the watermark', () => {
    expect(rollbackReaches(7, 7)).toBe(false);
    expect(rollbackReaches(7, 3)).toBe(false);
  });

  it('is true where there is anything to pop, and where the depth is unknown', () => {
    expect(rollbackReaches(7, 8)).toBe(true);
    expect(rollbackReaches(7, undefined)).toBe(true);
  });
});

describe('rewindConfirmCopy: the confirm names the size, and names whose it is', () => {
  it('names BOTH numbers when the user has laid work on top', () => {
    const copy = rewindConfirmCopy(t, { steps: 16, mine: 12 });
    expect(copy.confirmLabel).toBe('agent3.rewind_q_mine({"n":16,"mine":12})');
    expect(copy.question).toBe('agent3.rewind_cost_mine({"n":16,"mine":12})');
  });

  it('names the total alone when nothing of the user\'s stands above the job', () => {
    const copy = rewindConfirmCopy(t, { steps: 4, mine: 0 });
    expect(copy.confirmLabel).toBe('agent3.rewind_q({"n":4})');
    expect(copy.question).toBe('agent3.rewind_cost({"n":4})');
  });

  it('names the total HONESTLY where the split cannot be proven', () => {
    const copy = rewindConfirmCopy(t, { steps: 16 });
    expect(copy.confirmLabel).toBe('agent3.rewind_q({"n":16})');
  });

  it('reads its own singular', () => {
    expect(rewindConfirmCopy(t, { steps: 1, mine: 0 }).confirmLabel).toBe('agent3.rewind_q_one');
    expect(rewindConfirmCopy(t, { steps: 1, mine: 0 }).question).toBe('agent3.rewind_cost_one');
  });

  it('falls back to the unnumbered question where there is no depth to state', () => {
    expect(rewindConfirmCopy(t, null).confirmLabel).toBe('agent3.ticket_rewind_all_q');
  });

  /**
   * THE SINGULAR HAS TO SURVIVE THE `mine` BRANCH: a plural branch taken first reads the one-step
   * case with the user's own edit in it as "Rewind 1 steps, 1 yours?", and fr's participle then
   * agrees with a plural that is not there. `mine` can never exceed `steps`
   * (`rollbackCost` measures both from the same depth), so one step means one of them is the user's.
   *
   * Reachable whenever a job settles at or below its own first checkpoint — a write the rules
   * reverted, which is what the harness's `REVERTED:` feedback exists for — and the user then makes
   * one hand edit.
   */
  it('reads its singular through the mine branch too', () => {
    expect(rollbackCost(7, 8, 7)).toEqual({ steps: 1, mine: 1 });
    const copy = rewindConfirmCopy(t, { steps: 1, mine: 1 });
    expect(copy.confirmLabel).toBe('agent3.rewind_q_mine_one');
    expect(copy.question).toBe('agent3.rewind_cost_mine_one');
  });
});
