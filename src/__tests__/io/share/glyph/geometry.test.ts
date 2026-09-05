import { describe, it, expect } from 'vitest';
import { TIERS, tierFor, moduleBaseFor, bandSize, currentBandSize, dataModuleRect, nBlocks, GRID_COLS, GRID_ROWS, RS_K } from '../../../../io/share/glyph/geometry';
import { GLYPH_PROFILES, choosePlan, parityPolicyFor, planFor } from '../../../../io/share/glyph/profiles';

describe('glyph geometry', () => {
  it('tier capacities match the RS block formula', () => {
    for (const t of TIERS) expect(t.payloadCap).toBe(nBlocks(t) * RS_K);
  });
  it('tierFor picks the smallest fitting tier and nulls past the largest', () => {
    expect(tierFor(1)!.id).toBe(0);
    TIERS.forEach((t, i) => {
      expect(tierFor(t.payloadCap)!.id, `exactly filling tier ${i}`).toBe(t.id);
      const next = TIERS[i + 1];
      if (next) expect(tierFor(t.payloadCap + 1)!.id, `one past tier ${i}`).toBe(next.id);
    });
    expect(tierFor(TIERS[TIERS.length - 1]!.payloadCap + 1)).toBeNull();
  });
  it('pins the current density ladder and rejects retired v3 profile ids', () => {
    expect(GLYPH_PROFILES.map((p) => [p.id, p.bits, p.colors, p.div])).toEqual([
      [32, 2, 4, 1], [33, 2, 4, 2], [34, 2, 4, 3], [35, 2, 4, 4], [36, 2, 4, 6],
    ]);
  });
  it('bounds shortened codewords and fits every selected profile', () => {
    for (let length = 1; length <= 12_000; length++) {
      const plan = choosePlan(length)!;
      expect(plan, `payload ${length}`).not.toBeNull();
      expect(plan.symbolCount).toBeLessThanOrEqual(plan.moduleCount);
      expect(plan.codewordBytes).toBeLessThanOrEqual(255);
      expect(plan.parityBytes / plan.codewordBytes).toBeGreaterThanOrEqual(parityPolicyFor(plan.profile).minimum);
    }
    for (const length of [-1, 0, 0.5, 12_001, Infinity, NaN]) expect(choosePlan(length)).toBeNull();
  });
  it('selects the coarsest fitting profile', () => {
    for (const length of [91, 596, 2010, 2873, 6880, 12000]) {
      const plan = choosePlan(length)!;
      const earlier = GLYPH_PROFILES.slice(0, GLYPH_PROFILES.indexOf(plan.profile));
      expect(earlier.every((profile) => planFor(length, profile) === null)).toBe(true);
    }
  });
  it('keeps every current payload in the same shorter footprint', () => {
    expect(currentBandSize(12)).toEqual({ width: 1488, height: 312 });
    expect(currentBandSize(18)).toEqual({ width: 2232, height: 468 });
  });
  it('module base: 1600→12, 2400→18, 960→null', () => {
    expect(moduleBaseFor(1600)).toBe(12);
    expect(moduleBaseFor(2400)).toBe(18);
    expect(moduleBaseFor(960)).toBeNull();
  });
  it('band is the fixed footprint at any base', () => {
    expect(bandSize(12)).toEqual({ width: GRID_COLS * 12, height: GRID_ROWS * 12 });
  });
  it('every data module rect stays inside the band for every tier', () => {
    for (const t of TIERS) {
      const mb = 12, { width, height } = bandSize(mb);
      const last = dataModuleRect(t, t.dataCols * t.dataRows - 1, mb);
      expect(last.x + last.size).toBeLessThanOrEqual(width);
      expect(last.y + last.size).toBeLessThanOrEqual(height);
      expect(dataModuleRect(t, 0, mb).y).toBe(3 * mb);
    }
  });
  it('grid constants', () => { expect(GRID_COLS).toBe(124); expect(GRID_ROWS).toBe(30); });
});
