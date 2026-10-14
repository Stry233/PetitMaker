import { describe, it, expect } from 'vitest';
import { regionPulseFactor } from '../../../../view/shared/overlay/region-pulse';

describe('buildable region pulse', () => {
  it('starts and ends at full opacity and dips by the given amount halfway', () => {
    expect(regionPulseFactor(0, 0.5)).toBe(1);
    expect(regionPulseFactor(1, 0.5)).toBeCloseTo(1, 12);
    expect(regionPulseFactor(0.5, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('holds the end state outside the pulse', () => {
    expect(regionPulseFactor(-1, 0.4)).toBe(1);
    expect(regionPulseFactor(2, 0.4)).toBeCloseTo(1, 12);
  });
});
