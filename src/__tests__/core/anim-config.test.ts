import { describe, it, expect } from 'vitest';
import { animConfig } from '../../core/runtime/anim-config';
import { ItemCategory } from '../../core/model/types';

describe('animConfig', () => {
  it('commit flash is lighter than the rare error flash (not the error curve)', () => {
    // Commit flash is a visible light pulse but must stay clearly below the
    // error amplitude (raised from the original 0.22 to ~0.35 for visibility).
    expect(animConfig.flash.commit.peakAlpha).toBeLessThan(animConfig.flash.error.peakAlpha);
    expect(animConfig.flash.commit.peakAlpha).toBeLessThanOrEqual(0.4);
  });

  it('every ItemCategory has a same-hue poof tint', () => {
    for (const cat of Object.values(ItemCategory)) {
      expect(typeof animConfig.categoryColor[cat]).toBe('number');
    }
  });

  it('per-delete poof count cannot exceed the shared global particle cap', () => {
    expect(animConfig.puff.delete.countCap).toBeLessThanOrEqual(animConfig.puff.globalCap);
  });
});
