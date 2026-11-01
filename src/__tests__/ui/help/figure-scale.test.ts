import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { FIGURE_LEAST, figureShare } from '../../../ui/help/figures/figure-scale';

describe('the Help figure scale rule', () => {
  spec('UI-63', 'a figure that fits draws whole, one a little wider shrinks to its column, one far wider keeps the floor and crops', () => {
    expect(figureShare(600, 500)).toEqual({ share: 1, crop: false });
    const near = figureShare(600, 700);
    expect(near.crop).toBe(false);
    expect(near.share * 700).toBeCloseTo(600);
    for (const natural of [800, 1200, 4000]) {
      const far = figureShare(600, natural);
      expect(far.share).toBeGreaterThanOrEqual(FIGURE_LEAST);
      expect(far.crop).toBe(far.share * natural > 600);
    }
  });
});
