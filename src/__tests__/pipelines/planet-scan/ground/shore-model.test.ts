import { describe, expect, it } from 'vitest';
import { SHORE_MODEL, shoreModel } from '../../../../pipelines/planet-scan/ground/shore-model';
import weights from '../../../../pipelines/planet-scan/ground/shore-weights.json';

describe('the shore classifier', () => {
  it('gives the probabilities scikit-learn gave for the exported check rows', () => {
    expect(weights.checks.length).toBeGreaterThan(0);
    for (const check of weights.checks) {
      expect(SHORE_MODEL.predict(Float64Array.from(check.x))).toBeCloseTo(check.p, 6);
    }
  });

  it('reads the sea vote round a cell and its foam, never its colour', () => {
    expect(SHORE_MODEL.features).toHaveLength(36);
    expect(SHORE_MODEL.features.every((f) => /^(psea|sd)-?[\d.]+,-?[\d.]+$/.test(f) || f === 'anim' || f === 'tstdL')).toBe(true);
  });

  it('sends a missing value the way its node says', () => {
    const tree = { feature: [0, -1, -1], threshold: [1, 0, 0], left: [1, 0, 0], right: [2, 0, 0], missingLeft: [1, 0, 0], value: [0, -2, 2] };
    const m = shoreModel({ features: ['f'], baseline: 0, trees: [tree] });
    expect(m.predict(Float64Array.of(Number.NaN))).toBeCloseTo(1 / (1 + Math.exp(2)), 9);
    expect(m.predict(Float64Array.of(5))).toBeCloseTo(1 / (1 + Math.exp(-2)), 9);
  });
});
