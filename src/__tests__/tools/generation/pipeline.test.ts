import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { generateLandform } from '../../../tools/generation';
import { applyPlanToScratch } from '../../../tools/generation/repair';
import type { GenConfig } from '../../../tools/generation/types';
import { makeField } from '../../../tools/generation/field';
import { connectedFlatFraction } from '../../../tools/generation/usability';

const cfg = (over: Partial<GenConfig> = {}): GenConfig => ({
  mode: 'mixed', relief: 0.5, naturalness: 1, waterAmount: 0.4, rivers: 0.4,
  flatness: 0.5, settlement: 0.5, nature: 0.5, seed: 1, maxElevation: 6, region: null, ...over,
});

describe('generateLandform pipeline', () => {
  it('rule-robustness invariant: every generated plan is RuleRegistry-clean', () => {
    const reg = createDefaultRegistry();
    for (const seed of [1, 2, 7, 13, 99]) {
      for (const mode of ['earth', 'water', 'mixed'] as const) {
        const state = makeState(40, 40);
        const { plan } = generateLandform(cfg({ seed, mode }), state.template, reg);
        const scratch = applyPlanToScratch(plan, state.template);
        expect(reg.validatePostStroke(scratch), `seed ${seed} mode ${mode}`).toHaveLength(0);
      }
    }
  });

  it('high flatness guarantees a large connected buildable flat region', () => {
    // flatness 0.9 -> targetFlat ~0.5; usability peels mountains until at least that much
    // connected flat exists. Assert a solid floor (some slack for the relaxation cap).
    const reg = createDefaultRegistry();
    for (const seed of [1, 2, 7]) {
      const state = makeState(40, 40);
      const f = makeField(state);
      const { plan } = generateLandform(cfg({ seed, flatness: 0.9 }), state.template, reg);
      expect(connectedFlatFraction(plan, f.grass), `seed ${seed}`).toBeGreaterThanOrEqual(0.45);
    }
  });

  it('is deterministic for a (seed, config)', () => {
    const reg = createDefaultRegistry();
    const t = makeState(40, 40).template;
    const a = generateLandform(cfg({ seed: 5 }), t, reg).plan;
    const b = generateLandform(cfg({ seed: 5 }), t, reg).plan;
    expect(Array.from(a.tier)).toEqual(Array.from(b.tier));
    expect(Array.from(a.water)).toEqual(Array.from(b.water));
  });
});
