import { describe, it, expect, vi } from 'vitest';

// Synchronous decode matrix; about 40 s on an idle machine.
vi.setConfig({ testTimeout: 120_000 });
import { encodeGlyph } from '../../../../io/share/glyph/encode';
import { decodeGlyph } from '../../../../io/share/glyph/decode';
import { PRODUCT_PAPER } from '../../../../io/share/glyph/palette';
import * as D from './degrade';

const payload = (n: number) => { const a = new Uint8Array(n); let s = 0xfeed; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = s >>> 24; } return a; };
const eq = (a: Uint8Array | null, b: Uint8Array) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);
type Fx = (g: Uint8Array, w: number, h: number) => Uint8Array;
const sub = (g: Uint8Array, w: number, h: number) => D.chromaSubsample420(g, w, h);
const chain = (...fs: Fx[]): Fx => (g, w, h) => fs.reduce((acc, f) => f(acc, w, h), g);

function embed(glyph: { rgba: Uint8Array; width: number; height: number }, padX: number, padTop: number) {
  const width = glyph.width + padX * 2;
  const height = glyph.height + padTop + 20;
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba[pixel * 4] = PRODUCT_PAPER[0];
    rgba[pixel * 4 + 1] = PRODUCT_PAPER[1];
    rgba[pixel * 4 + 2] = PRODUCT_PAPER[2];
    rgba[pixel * 4 + 3] = 255;
  }
  for (let y = 0; y < glyph.height; y++) {
    const source = y * glyph.width * 4;
    const target = ((y + padTop) * width + padX) * 4;
    rgba.set(glyph.rgba.subarray(source, source + glyph.width * 4), target);
  }
  return { rgba, width, height };
}

const RATED: [number, Fx[]][] = [
  [780, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 40)), (g, w, h) => D.downUp(g, w, h, 0.5), chain(sub, (g, w, h) => D.jpegLike(g, w, h, 60), (g, w, h) => D.downUp(g, w, h, 0.75)), (g) => D.colorShift(g, 14, -8, 10), (g) => D.noise(g, 18, 7), (g, w, h) => D.gaussStd(g, w, h)]],
  [1100, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 60)), (g, w, h) => D.downUp(g, w, h, 0.67), (g) => D.colorShift(g, 10, -6, 8), (g, w, h) => D.gaussStd(g, w, h)]],
  [2300, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 75)), (g, w, h) => D.downUp(g, w, h, 0.85), (g, w, h) => D.gaussSmall(g, w, h)]],
  [3700, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 85)), (g, w, h) => D.gaussSmall(g, w, h)]],
  [4200, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 85))]],
  [6800, [chain(sub, (g, w, h) => D.jpegLike(g, w, h, 85))]],
  [10033, []],
];

describe('glyph robustness matrix (exact-or-null; wrong bytes = suite failure)', () => {
  for (const [n, fxs] of RATED) {
    for (let f = 0; f < fxs.length; f++) {
      it(`${n} B survives rated transform #${f}`, () => {
        const data = payload(n);
        const g = encodeGlyph(data, 12)!;
        const t = fxs[f]!(new Uint8Array(g.rgba), g.width, g.height);
        expect(eq(decodeGlyph(t, g.width, g.height), data)).toBe(true);
      });
    }
  }
  it('out-of-envelope fails to null or returns exact bytes', () => {
    for (const [n] of RATED) {
      const data = payload(n);
      const g = encodeGlyph(data, 12)!;
      for (const t of [D.downUp(g.rgba, g.width, g.height, 0.25), D.randomImage(g.rgba.length, 3)]) {
        const out = decodeGlyph(t, g.width, g.height);
        expect(out === null || eq(out, data)).toBe(true);
      }
    }
  });
  it('the densest profile round-trips at moduleBase 18', () => {
    const data = payload(10033);
    const g = encodeGlyph(data, 18)!;
    expect(g.profile.name).toBe('4-tone/6');
    expect(eq(decodeGlyph(g.rgba, g.width, g.height), data)).toBe(true);
  });
  it('localizes a blurred dense capsule at a nonzero pixel phase', () => {
    const data = payload(2873);
    const glyph = encodeGlyph(data, 12)!;
    expect(glyph.profile.name).toBe('4-tone/3');
    const composition = embed(glyph, 8, 12);
    const blurred = D.gaussSmall(composition.rgba, composition.width, composition.height);
    expect(eq(decodeGlyph(blurred, composition.width, composition.height), data)).toBe(true);
  });
});
