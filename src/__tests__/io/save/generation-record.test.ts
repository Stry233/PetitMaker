import { describe, it, expect } from 'vitest';
import { isGenerationConfig } from '../../../io/save/generation-record';

describe('isGenerationConfig', () => {
  it('accepts a config with a finite seed and a string algorithm', () => {
    expect(isGenerationConfig({ algorithm: 'designed', seed: 42, mode: 'mixed', corridorWidth: 1, maxElevation: 8, region: null })).toBe(true);
  });

  it('rejects a non-object, a missing algorithm, and a non-finite seed', () => {
    expect(isGenerationConfig(null)).toBe(false);
    expect(isGenerationConfig('designed')).toBe(false);
    expect(isGenerationConfig({ seed: 1 })).toBe(false);
    expect(isGenerationConfig({ algorithm: 'designed', seed: Number.NaN })).toBe(false);
    expect(isGenerationConfig({ algorithm: 7, seed: 1 })).toBe(false);
  });
});
