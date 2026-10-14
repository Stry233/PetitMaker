import { describe, it, expect, vi } from 'vitest';
import type { DesignedOutcome } from '../../../tools/generation/designer';
import { makeState } from '../../_support/map-state';
import { defaultConfig } from '../../../tools/generation/recipe';

const refused = { roads: 1, anchors: 2, lanes: 3, crossings: 4 };

vi.mock('../../../tools/generation/designer', () => ({
  generateDesigned: (): Partial<DesignedOutcome> => ({ placed: 5, refused }),
}));

const { generateTerrain } = await import('../../../tools/generation');

describe('a designed run reports its refusals', () => {
  it('counts every refused kind in the skipped total, crossings included', () => {
    const state = makeState(8, 8);
    const result = generateTerrain(
      { state, execute: () => ({ success: true, errors: [] }), reg: undefined as never },
      defaultConfig('designed', { maxElevation: 2, seed: 1 }),
    );
    expect(result.skipped).toBe(refused.roads + refused.anchors + refused.lanes + refused.crossings);
  });
});
