import { describe, it, expect } from 'vitest';
import { lerpClamped, median, medianInPlace } from '../../../core/base/math';

describe('median', () => {
  const sorted = (v: number[]) => v.slice().sort((a, b) => a - b);

  it('takes the middle value of an odd count', () => {
    expect(median([5, 1, 3], 'mean')).toBe(3);
    expect(median([5, 1, 3], 'lower')).toBe(3);
  });

  it('takes the mean, the lower or the upper of the two middle values of an even count', () => {
    expect(median([4, 1, 3, 2], 'mean')).toBe(2.5);
    expect(median([4, 1, 3, 2], 'lower')).toBe(2);
    expect(median([4, 1, 3, 2], 'upper')).toBe(3);
    expect(median([5, 1, 3], 'upper')).toBe(3);
  });

  it('reads 0 for no values and leaves its input unchanged', () => {
    expect(median([], 'mean')).toBe(0);
    const values = [3, 1, 2];
    median(values, 'mean');
    expect(values).toEqual([3, 1, 2]);
  });

  it('agrees with a sort on repeated and spread values', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let t = 0; t < 500; t++) {
      const v = Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => (t % 2 ? Math.floor(rnd() * 4) : rnd() * 100 - 50));
      const s = sorted(v), m = s.length >> 1;
      expect(median(v, 'lower')).toBe(s[(s.length - 1) >> 1]);
      expect(median(v, 'upper')).toBe(s[m]);
      expect(median(v, 'mean')).toBe(s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2);
      expect(medianInPlace(Float64Array.from(v), v.length, 'mean')).toBe(median(v, 'mean'));
    }
  });
});

describe('lerpClamped', () => {
  it('interpolates inside [0, 1] and holds the ends outside it', () => {
    expect(lerpClamped(2, 6, 0.25)).toBe(3);
    expect(lerpClamped(2, 6, -1)).toBe(2);
    expect(lerpClamped(2, 6, 3)).toBe(6);
  });
  it('passes NaN through', () => {
    expect(lerpClamped(2, 6, Number.NaN)).toBeNaN();
  });
});
