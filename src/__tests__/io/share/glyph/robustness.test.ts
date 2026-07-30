import { describe, it, expect } from 'vitest';
import { encodeGlyph } from '../../../../io/share/glyph/encode';
import { decodeGlyph } from '../../../../io/share/glyph/decode';
import * as D from './degrade';

const payload = (n: number) => { const a = new Uint8Array(n); let s = 0xfeed; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = s >>> 24; } return a; };
const eq = (a: Uint8Array | null, b: Uint8Array) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);
type Fx = (g: Uint8Array, w: number, h: number) => Uint8Array;
const sub = (g: Uint8Array, w: number, h: number) => D.chromaSubsample420(g, w, h);
const chain = (...fs: Fx[]): Fx => (g, w, h) => fs.reduce((acc, f) => f(acc, w, h), g);

// tier → payload bytes at ~85% capacity, and the transform set that must stay EXACT.
const RATED: [number, number, Fx[]][] = [
  [0, 780, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 40)), (g, w, h) => D.downUp(g, w, h, 0.5), chain(sub, (g, w, h) => D.jpegLike(g, w, h, 60), (g, w, h) => D.downUp(g, w, h, 0.75)), (g) => D.colorShift(g, 14, -8, 10), (g) => D.noise(g, 18, 7), (g, w, h) => D.gaussStd(g, w, h)]],
  [1, 1100, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 60)), (g, w, h) => D.downUp(g, w, h, 0.67), (g) => D.colorShift(g, 10, -6, 8), (g, w, h) => D.gaussStd(g, w, h)]],
  [2, 2300, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 75)), (g, w, h) => D.downUp(g, w, h, 0.85), (g, w, h) => D.gaussSmall(g, w, h)]],
  [3, 4200, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 85)), (g, w, h) => D.gaussSmall(g, w, h)]],
  [4, 9000, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 85))]],
  [5, 19000, []], // T5 has no rated lossy transform (clean-only, exact-pixels tier) — but MUST
  // still appear in the out-of-envelope fails-safe loop below (brutal transforms → null, never wrong).
];

describe('glyph robustness matrix (exact-or-null; wrong bytes = suite failure)', () => {
  for (const [tid, n, fxs] of RATED) {
    for (let f = 0; f < fxs.length; f++) {
      it(`T${tid} survives rated transform #${f}`, () => {
        const data = payload(n);
        const g = encodeGlyph(data, 12)!;
        expect(g.tier.id).toBe(tid);
        const t = fxs[f]!(new Uint8Array(g.rgba), g.width, g.height);
        expect(eq(decodeGlyph(t, g.width, g.height), data)).toBe(true);
      });
    }
  }
  it('out-of-envelope fails to NULL, never wrong bytes (all tiers, brutal transforms)', () => {
    for (const [, n] of RATED) {
      const data = payload(n);
      const g = encodeGlyph(data, 12)!;
      for (const t of [D.downUp(g.rgba, g.width, g.height, 0.25), D.randomImage(g.rgba.length, 3)]) {
        const out = decodeGlyph(t, g.width, g.height);
        expect(out === null || eq(out, data)).toBe(true); // exact or null — wrong is impossible
      }
    }
  });
  it('T5 round-trips at moduleBase 18 (fractional 4.5px data modules)', () => {
    const data = payload(19000);
    const g = encodeGlyph(data, 18)!;
    expect(g.tier.id).toBe(5);
    expect(eq(decodeGlyph(g.rgba, g.width, g.height), data)).toBe(true);
  });
});
