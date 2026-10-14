import { describe, expect, it } from 'vitest';
import { cssMotion, framerMotion, outMotion, seconds } from '../../../../ui/design/motion';

describe('shared motion adapters', () => {
  it('preserves spring physics and rejects an implicit fixed-duration conversion', () => {
    expect(framerMotion('mode.plate.arrive').type).toBe('spring');
    expect(outMotion('mode.plate.arrive').duration).toBeUndefined();
    expect(() => seconds('mode.plate.arrive')).toThrow('spring');
    expect(() => cssMotion('mode.plate.arrive', ['transform'])).toThrow('spring');
  });

  it('removes travel for timed and physical transitions under reduced motion', () => {
    for (const id of ['modal.resize', 'mode.plate.arrive'] as const) {
      expect(framerMotion(id, true)).toEqual({ duration: 0 });
      expect(cssMotion(id, ['transform'], true)).toBe('none');
    }
  });
});
