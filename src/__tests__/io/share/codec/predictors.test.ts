import { describe, it, expect } from 'vitest';
import { emptyCanonical, replayCanonical } from '../../../../io/share/codec/predictors';
import { canonicalBytes } from '../../../../io/share/canonical';
import type { GenerateConfig } from '../../../../core/model/types';

describe('predictors', () => {
  it('emptyCanonical is deterministic and empty', () => {
    const a = emptyCanonical('hexia'), b = emptyCanonical('hexia');
    expect(canonicalBytes(a)).toEqual(canonicalBytes(b));
    expect(a.objects.length).toBe(0);
  });
  it('replayCanonical is deterministic for a seed/config', async () => {
    const cfg: GenerateConfig = { algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 8, seed: 7, region: null };
    const a = await replayCanonical('hexia', cfg);
    const b = await replayCanonical('hexia', cfg);
    expect(canonicalBytes(a)).toEqual(canonicalBytes(b));
    expect(a.objects.length).toBeGreaterThan(50);
  }, 240000);
});
