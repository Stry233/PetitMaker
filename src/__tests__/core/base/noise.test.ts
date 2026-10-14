import { describe, expect, it } from 'vitest';
import { smoothLattice, valueNoise01 } from '../../../core/base/noise';

describe('smoothLattice', () => {
  const lattice = (ix: number, iy: number): number => ix * 10 + iy;

  it('returns the lattice value on a lattice point', () => {
    expect(smoothLattice(lattice, 2, 3)).toBe(23);
  });

  it('blends with smoothstep weights between points', () => {
    expect(smoothLattice(lattice, 2.5, 3)).toBe(28);
    expect(smoothLattice(lattice, 2.25, 3)).toBeCloseTo(23 + 10 * 0.15625, 12);
  });
});

describe('valueNoise01', () => {
  it('is a pure function of its seed, inside 0..1', () => {
    const a = valueNoise01(7), b = valueNoise01(7), c = valueNoise01(8);
    expect(a(3.3, 4.7)).toBe(b(3.3, 4.7));
    expect(a(3.3, 4.7)).not.toBe(c(3.3, 4.7));
    for (let i = 0; i < 50; i++) {
      const v = a(i * 0.37, i * 0.91);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
