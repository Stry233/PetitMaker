import { describe, it, expect } from 'vitest';
import { encodeGlyph, encodeGlyphV2 } from '../../../../io/share/glyph/encode';
import { decodeGlyph } from '../../../../io/share/glyph/decode';
import { currentBandSize, dataModuleRect, type Tier } from '../../../../io/share/glyph/geometry';
import { BG, PALETTE16 } from '../../../../io/share/glyph/palette';

const payload = (n: number, seed = 5) => { const a = new Uint8Array(n); let s = seed >>> 0; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = s >>> 24; } return a; };
const eq = (a: Uint8Array | null, b: Uint8Array) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);

/** Paste the band into a taller white "composition" at an offset (title/map above, footer below). */
function inComposition(g: { rgba: Uint8Array; width: number; height: number }, padTop: number, padX: number) {
  const W = g.width + 2 * padX, H = g.height + padTop + 80;
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = BG[0]; out[i * 4 + 1] = BG[1]; out[i * 4 + 2] = BG[2]; out[i * 4 + 3] = 255; }
  for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) {
    const si = (y * g.width + x) * 4, di = ((y + padTop) * W + (x + padX)) * 4;
    out[di] = g.rgba[si]!; out[di + 1] = g.rgba[si + 1]!; out[di + 2] = g.rgba[si + 2]!; out[di + 3] = 255;
  }
  return { rgba: out, width: W, height: H };
}

describe('glyph exact round-trip', () => {
  for (const n of [91, 300, 1100, 2000, 4200, 6800, 10033]) {
    it(`${n} B clean, standalone band`, () => {
      const g = encodeGlyph(payload(n), 12)!;
      expect(eq(decodeGlyph(g.rgba, g.width, g.height), payload(n))).toBe(true);
      expect({ width: g.width, height: g.height }).toEqual(currentBandSize(12));
    });
  }
  it('decodes inside a composition with chrome above/below', () => {
    const g = encodeGlyph(payload(900), 12)!;
    const c = inComposition(g, 700, 8);
    expect(eq(decodeGlyph(c.rgba, c.width, c.height), payload(900))).toBe(true);
  });
  it('decodes at a larger module base', () => {
    const g = encodeGlyph(payload(300), 18)!;
    expect(g.width).toBe(currentBandSize(18).width);
    expect(eq(decodeGlyph(g.rgba, g.width, g.height), payload(300))).toBe(true);
  });
  it('fails safe on a random image (null, never bytes)', () => {
    const junk = payload(1584 * 360 * 4, 99);
    expect(decodeGlyph(junk, 1584, 360)).toBeNull();
  });

  it('retains finder separation for the v2 row-major transport', () => {
    const n = 1100;
    const mb = 12;
    const g = encodeGlyphV2(payload(n), mb)!;
    const darkest = PALETTE16.reduce((a, b) => (a[0] + a[1] + a[2] <= b[0] + b[1] + b[2] ? a : b));
    expect(darkest[0] + darkest[1] + darkest[2]).toBeLessThan(150);

    const rgba = new Uint8Array(g.rgba);
    const tier: Pick<Tier, 'div' | 'dataCols'> = g.tier;
    for (let k = 0; k < tier.dataCols; k++) {
      const rect = dataModuleRect(tier, k, mb);
      const x0 = Math.round(rect.x), y0 = Math.round(rect.y), size = Math.round(rect.size);
      for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) {
        const i = (y * g.width + x) * 4;
        rgba[i] = darkest[0]; rgba[i + 1] = darkest[1]; rgba[i + 2] = darkest[2]; rgba[i + 3] = 255;
      }
    }

    expect(eq(decodeGlyph(rgba, g.width, g.height), payload(n))).toBe(true);
  });
});
