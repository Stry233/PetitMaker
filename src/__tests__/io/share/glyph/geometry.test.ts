import { describe, it, expect } from 'vitest';
import { TIERS, tierFor, moduleBaseFor, bandSize, dataModuleRect, nBlocks, GRID_COLS, GRID_ROWS, RS_K } from '../../../../io/share/glyph/geometry';

describe('glyph geometry', () => {
  it('tier capacities match the RS block formula', () => {
    for (const t of TIERS) expect(t.payloadCap).toBe(nBlocks(t) * RS_K);
  });
  it('tierFor picks the smallest fitting tier and nulls past the largest', () => {
    // Read off the ladder rather than restated, so re-sizing the band or the parity does not
    // rewrite this test — only the ordering it asserts has to hold.
    expect(tierFor(1)!.id).toBe(0);
    TIERS.forEach((t, i) => {
      expect(tierFor(t.payloadCap)!.id, `exactly filling tier ${i}`).toBe(t.id);
      const next = TIERS[i + 1];
      if (next) expect(tierFor(t.payloadCap + 1)!.id, `one past tier ${i}`).toBe(next.id);
    });
    expect(tierFor(TIERS[TIERS.length - 1]!.payloadCap + 1)).toBeNull();
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
