import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { repairPlan, applyPlanToScratch } from '../../../tools/generation/repair';
import type { TerrainPlan } from '../../../tools/generation/types';

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

  it('leaves an already-legal plan unchanged', () => {
    const state = makeState(12, 12);
    const plan = emptyPlan(12, 12); // all ground = trivially legal
    const reg = createDefaultRegistry();
    const fixed = repairPlan(plan, state.template, reg);
    expect(Array.from(fixed.tier)).toEqual(Array.from(plan.tier));
    expect(Array.from(fixed.water)).toEqual(Array.from(plan.water));
  });
});
