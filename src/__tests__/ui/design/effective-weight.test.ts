import { describe, it, expect } from 'vitest';
import { effectiveWeight } from '../../../ui/design/scale';

/**
 * Threshold rationale:
 *   1080p  → scale = 1080/1918 ≈ 0.563, DPR 1 → 0.563×1 = 0.56 < 0.7  → cap heavy weights
 *   1440p  → scale = 1440/1918 ≈ 0.75,  DPR 1 → 0.75×1  = 0.75 ≥ 0.7  → keep heavy weights
 *   1080p + DPR 2 → 0.563×min(2,2) = 1.13 ≥ 0.7 → keep heavy weights
 */
describe('effectiveWeight', () => {
  it('caps 900 to 600 at 1080p DPR 1 (0.563 × 1 = 0.56 < 0.7)', () => {
    expect(effectiveWeight(900, 0.563, 1)).toBe(600);
  });

  it('caps 800 to 600 at 1080p DPR 1 (0.563 × 1 = 0.56 < 0.7)', () => {
    expect(effectiveWeight(800, 0.563, 1)).toBe(600);
  });

  it('leaves 700 unchanged at 1080p DPR 1 (only heavy weights ≥ 800 are capped)', () => {
    expect(effectiveWeight(700, 0.563, 1)).toBe(700);
  });

  it('leaves 900 unchanged at 1440p DPR 1 (0.75 × 1 = 0.75 ≥ 0.7, user reports fine)', () => {
    expect(effectiveWeight(900, 0.75, 1)).toBe(900);
  });

  it('leaves 900 unchanged at 1080p DPR 2 (0.563 × 2 = 1.13 ≥ 0.7, hi-DPR display)', () => {
    expect(effectiveWeight(900, 0.563, 2)).toBe(900);
  });

  it('leaves 900 unchanged at 2160p DPR 1 (1.126 × 1 = 1.13 ≥ 0.7, 4K display)', () => {
    expect(effectiveWeight(900, 1.126, 1)).toBe(900);
  });
});
