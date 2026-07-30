import { describe, it, expect } from 'vitest';
import { enforceUsability, connectedFlatFraction } from '../../../tools/generation/usability';
import type { TerrainPlan } from '../../../tools/generation/types';

function densePlan(w: number, h: number): TerrainPlan { // mountains everywhere = unusable
  return { width: w, height: h, tier: new Int8Array(w * h).fill(2), water: new Int8Array(w * h).fill(-1) };
}
describe('enforceUsability', () => {
  it('raises the connected-flat fraction to ≥ target', () => {
    const plan = densePlan(30, 30); const grass = new Uint8Array(30 * 30).fill(1);
    enforceUsability(plan, grass, 0.4);
    expect(connectedFlatFraction(plan, grass)).toBeGreaterThanOrEqual(0.4);
  });
});
