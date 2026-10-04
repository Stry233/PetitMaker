import { describe, it, expect } from 'vitest';
import { animConfig } from '../../../core/runtime/anim-config';

describe('animConfig', () => {
  it('commit flash is lighter than the rare error flash (not the error curve)', () => {
    // A commit flash is a visible light pulse that stays clearly below the error amplitude.
    expect(animConfig.flash.commit.peakAlpha).toBeLessThan(animConfig.flash.error.peakAlpha);
    expect(animConfig.flash.commit.peakAlpha).toBeLessThanOrEqual(0.4);
  });

  it('per-delete poof count cannot exceed the shared global particle cap', () => {
    expect(animConfig.puff.delete.countCap).toBeLessThanOrEqual(animConfig.puff.globalCap);
  });
});
