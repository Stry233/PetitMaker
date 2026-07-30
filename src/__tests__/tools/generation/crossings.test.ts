import { describe, it, expect } from 'vitest';
import { generateLandform, toGenConfig } from '../../../tools/generation';
import { seamCells } from '../../../tools/generation/zone-water';
import { TUNING } from '../../../tools/generation/tuning';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import type { GenerateConfig } from '../../../core/model/types';

const cfg = (seed: number): GenerateConfig => ({ algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed, region: null });

describe('crossing plan', () => {
  it('every zone is reachable from the town via open seams + planned crossings; budget respected', () => {
    for (const seed of [4, 42, 99]) {
      const { plan, zonePlan: zp } = generateLandform(toGenConfig(cfg(seed)), makeState(64, 64).template, createDefaultRegistry());
      expect(zp.crossings.length, `seed ${seed}: crossings planned`).toBeGreaterThan(0);
      // an OPEN seam = same level and no water on the shared seam cells (walk through freely)
      const open = (a: number, b: number): boolean => {
        if (zp.zones[a]!.level !== zp.zones[b]!.level) return false;
        const seam = [...seamCells(zp, a, b), ...seamCells(zp, b, a)]; // both sides, like the planner
        return seam.length > 0 && !seam.some((i) => plan.water[i]! >= 0);
      };
      const linked = new Set([0]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const z of zp.zones) {
          if (linked.has(z.id)) continue;
          const viaSeam = [...(zp.adjacency.get(z.id) ?? [])].some((n) => linked.has(n) && open(z.id, n));
          const viaCross = zp.crossings.some((c) => (c.a === z.id && linked.has(c.b)) || (c.b === z.id && linked.has(c.a)));
          if (viaSeam || viaCross) { linked.add(z.id); grew = true; }
        }
      }
      // Crown terraces are scenic massif steps — intentionally NOT crossing-connected (the base joins
      // the network; the peak is a view). Every NON-crown zone must still be reachable.
      const reachTarget = zp.zones.filter((z) => !z.crown).length;
      const reached = zp.zones.filter((z) => !z.crown && linked.has(z.id)).length;
      expect(reached, `seed ${seed}: all non-crown zones reachable`).toBe(reachTarget);
      const budget = (reachTarget - 1) + TUNING.loopCrossingBase + Math.round(0.5 * TUNING.loopCrossingPerSettlement) + TUNING.gorgeBridgeMax;
      expect(zp.crossings.length, `seed ${seed}: scarce`).toBeLessThanOrEqual(budget);
    }
  });
});
