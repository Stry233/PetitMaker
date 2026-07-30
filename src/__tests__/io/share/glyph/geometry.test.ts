import { describe, it, expect } from 'vitest';
import { TIERS, tierFor, moduleBaseFor, bandSize, dataModuleRect, nBlocks, GRID_COLS, GRID_ROWS } from '../../../../io/share/glyph/geometry';

describe('glyph geometry', () => {
  it('tier capacities match the RS block formula', () => {
    for (const t of TIERS) expect(t.payloadCap).toBe(nBlocks(t) * 184);
  });
  it('tierFor picks the smallest fitting tier and nulls past T5', () => {
    expect(tierFor(100)!.id).toBe(0);
    expect(tierFor(921)!.id).toBe(1);
    expect(tierFor(1289)!.id).toBe(2);
    expect(tierFor(2761)!.id).toBe(3);
    expect(tierFor(4969)!.id).toBe(4);
    expect(tierFor(11409)!.id).toBe(5);
    expect(tierFor(20425)).toBeNull();
  });
  it('module base: 1600→12, 2400→18, 960→null', () => {
    expect(moduleBaseFor(1600)).toBe(12);
    expect(moduleBaseFor(2400)).toBe(18);
    expect(moduleBaseFor(960)).toBeNull();
  });
  it('band is the fixed footprint at any base', () => {
    expect(bandSize(12)).toEqual({ width: 132 * 12, height: 30 * 12 });
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
  it('grid constants', () => { expect(GRID_COLS).toBe(132); expect(GRID_ROWS).toBe(30); });
});
