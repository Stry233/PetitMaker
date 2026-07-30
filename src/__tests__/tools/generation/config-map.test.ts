import { describe, it, expect } from 'vitest';
import { toGenConfig } from '../../../tools/generation';
import type { GenerateConfig } from '../../../core/model/types';

const cfg = (over: Partial<GenerateConfig> = {}): GenerateConfig => ({
  algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 9, region: null, ...over,
});

describe('toGenConfig', () => {
  it('earth mode zeroes water + rivers', () => {
    const g = toGenConfig(cfg({ mode: 'earth' }));
    expect(g.mode).toBe('earth'); expect(g.waterAmount).toBe(0); expect(g.rivers).toBe(0);
  });
  it('passes through explicit advanced fields for non-earth modes', () => {
    const g = toGenConfig(cfg({ mode: 'mixed', relief: 0.2, naturalness: 0.4, waterAmount: 0.9, rivers: 0.8, flatness: 0.3 }));
    expect(g.relief).toBe(0.2); expect(g.naturalness).toBe(0.4);
    expect(g.waterAmount).toBe(0.9); expect(g.rivers).toBe(0.8); expect(g.flatness).toBe(0.3);
  });
  it('defaults the advanced sliders when omitted (seed-first)', () => {
    const g = toGenConfig(cfg());
    expect(g.relief).toBe(0.8); expect(g.naturalness).toBe(1); expect(g.flatness).toBe(0.5);
    expect(g.maxElevation).toBe(6); expect(g.seed).toBe(9);
  });
  it('defaults settlement + nature to 0.5, passes them through when set', () => {
    expect(toGenConfig(cfg()).settlement).toBe(0.5);
    expect(toGenConfig(cfg()).nature).toBe(0.5);
    expect(toGenConfig(cfg({ settlement: 0.2, nature: 0.9 })).settlement).toBe(0.2);
    expect(toGenConfig(cfg({ settlement: 0.2, nature: 0.9 })).nature).toBe(0.9);
  });
});
