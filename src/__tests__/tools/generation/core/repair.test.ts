import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../../../rules/index';
import { makeState } from '../../../rules/_helpers';
import { repairPlan, applyPlanToScratch } from '../../../../tools/generation/core/repair';
import type { TerrainPlan } from '../../../../tools/generation/core/types';
import type { ValidationError } from '../../../../core/model/types';

function emptyPlan(w: number, h: number): TerrainPlan {
  return { width: w, height: h, tier: new Int8Array(w * h), water: new Int8Array(w * h).fill(-1) };
}

describe('repairPlan (RuleRegistry oracle)', () => {
  it('repairs a 3x3-base violation (lone tall spike) to a rule-clean plan', () => {
    const state = makeState(12, 12);
    const plan = emptyPlan(12, 12);
    plan.tier[6 * 12 + 6] = 8; // lone elevation-8 spike → violates V-MTN-03
    const reg = createDefaultRegistry();
    const fixed = repairPlan(plan, state.template, reg);
    const scratch = applyPlanToScratch(fixed, state.template);
    expect(reg.validatePostStroke(scratch)).toHaveLength(0);
  });

  it('repairs an open-faced water cell (containment violation) to clean', () => {
    const state = makeState(12, 12);
    const plan = emptyPlan(12, 12);
    plan.water[5 * 12 + 5] = 2; // water with no caps → V-WTR-02
    const reg = createDefaultRegistry();
    const fixed = repairPlan(plan, state.template, reg);
    const scratch = applyPlanToScratch(fixed, state.template);
    expect(reg.validatePostStroke(scratch)).toHaveLength(0);
  });

  it('takes both the water and a tier from a cell two rules flag, in the one pass', () => {
    // A plan can hold water OVER mass (the water wins where both are set), so a cell flagged by two
    // rules has two things to give and must give up only one per pass. Written against a dispatcher of
    // this test's own, since no pair of real rules is guaranteed to flag one cell together.
    const state = makeState(12, 12);
    const plan = emptyPlan(12, 12);
    const i = 5 * 12 + 5;
    plan.water[i] = 2;
    plan.tier[i] = 4;
    const cells = [{ x: 5, y: 5 }];
    let asked = 0;
    const fixed = repairPlan(plan, state.template, {
      validatePreCommand: () => [],
      getRules: () => [],
      validatePostStroke: () => (asked++ === 0
        ? [
          { ruleId: 'X', message: 'x', cells, severity: 'error' },
          { ruleId: 'Y', message: 'y', cells, severity: 'error' },
        ]
        : []),
    });
    expect(fixed.water[i]).toBe(-1);
    expect(fixed.tier[i]).toBe(3);
  });

  it('levels the block beside a flagged cell that has nothing of its own to give', () => {
    // The waterfall's downstream row (V-WTR-03) flags the cells that are out of line with the first
    // one, which are the BARE ones — the block sticking up among them is what has to come down.
    const state = makeState(12, 12);
    const plan = emptyPlan(12, 12);
    const beside = 4 * 12 + 5;
    plan.tier[beside] = 2;
    let asked = 0;
    const fixed = repairPlan(plan, state.template, {
      validatePreCommand: () => [],
      getRules: () => [],
      validatePostStroke: (): ValidationError[] => {
        asked++;
        return [{ ruleId: 'X', message: 'x', cells: [{ x: 5, y: 5 }], severity: 'error' }];
      },
    });
    expect(fixed.tier[beside], 'the block came down rather than the loop spinning').toBe(0);
    expect(asked, 'a pass per tier and then a stop, not the whole cap').toBe(3);
  });

  it('takes a water body beside a stuck cell whole, not a cell at a time', () => {
    const state = makeState(12, 12);
    const plan = emptyPlan(12, 12);
    const body = [5 * 12 + 6, 5 * 12 + 7, 5 * 12 + 8, 6 * 12 + 8];
    for (const i of body) plan.water[i] = 2;
    let asked = 0;
    const fixed = repairPlan(plan, state.template, {
      validatePreCommand: () => [],
      getRules: () => [],
      validatePostStroke: () => (asked++ === 0
        ? [{ ruleId: 'X', message: 'x', cells: [{ x: 5, y: 5 }], severity: 'error' }]
        : []),
    });
    for (const i of body) expect(fixed.water[i]).toBe(-1);
  });

  it('gives up on a plan that has nothing left to give instead of running out the cap', () => {
    const state = makeState(12, 12);
    const plan = emptyPlan(12, 12); // bare ground: no water, no mass, no neighbour with any
    let asked = 0;
    repairPlan(plan, state.template, {
      validatePreCommand: () => [],
      getRules: () => [],
      validatePostStroke: () => {
        asked++;
        return [{ ruleId: 'X', message: 'x', cells: [{ x: 5, y: 5 }], severity: 'error' }];
      },
    });
    expect(asked).toBe(1);
  });

  it('leaves an already-legal plan unchanged', () => {
    const state = makeState(12, 12);
    const plan = emptyPlan(12, 12); // all ground = trivially legal
    const reg = createDefaultRegistry();
    const fixed = repairPlan(plan, state.template, reg);
    expect(Array.from(fixed.tier)).toEqual(Array.from(plan.tier));
    expect(Array.from(fixed.water)).toEqual(Array.from(plan.water));
  });
});
