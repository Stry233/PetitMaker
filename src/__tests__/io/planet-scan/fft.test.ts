import { describe, expect, it } from 'vitest';
import { Fft, Fft2d, isPowerOfTwo, nextPowerOfTwo, splitRealPair } from '../../../io/planet-scan/fft';
import { rng } from './synthetic';

function naiveDft2d(re: Float64Array, im: Float64Array, w: number, h: number): [Float64Array, Float64Array] {
  const outRe = new Float64Array(w * h);
  const outIm = new Float64Array(w * h);
  for (let ky = 0; ky < h; ky++) {
    for (let kx = 0; kx < w; kx++) {
      let sr = 0;
      let si = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const t = -2 * Math.PI * ((kx * x) / w + (ky * y) / h);
          const c = Math.cos(t);
          const s = Math.sin(t);
          const p = y * w + x;
          sr += re[p]! * c - im[p]! * s;
          si += re[p]! * s + im[p]! * c;
        }
      }
      outRe[ky * w + kx] = sr;
      outIm[ky * w + kx] = si;
    }
  }
  return [outRe, outIm];
}

function randomGrid(n: number, seed: number): Float64Array {
  const r = rng(seed);
  return Float64Array.from({ length: n }, () => r() * 2 - 1);
}

describe('fft', () => {
  it('sizes transforms to powers of two', () => {
    expect(nextPowerOfTwo(340)).toBe(512);
    expect(nextPowerOfTwo(256)).toBe(256);
    expect(isPowerOfTwo(150)).toBe(false);
    expect(() => new Fft(12)).toThrow();
  });

  it('matches the direct DFT in 1D and inverts it', () => {
    const n = 16;
    const re = randomGrid(n, 1);
    const im = randomGrid(n, 2);
    const [wantRe, wantIm] = naiveDft2d(re, im, n, 1);
    const fft = new Fft(n);
    const r = re.slice();
    const i = im.slice();
    fft.forward(r, i);
    for (let k = 0; k < n; k++) {
      expect(r[k]).toBeCloseTo(wantRe[k]!, 9);
      expect(i[k]).toBeCloseTo(wantIm[k]!, 9);
    }
    fft.inverse(r, i);
    for (let k = 0; k < n; k++) {
      expect(r[k]).toBeCloseTo(re[k]!, 12);
      expect(i[k]).toBeCloseTo(im[k]!, 12);
    }
  });

  it('matches the direct DFT in 2D on a non-square grid and inverts it', () => {
    const w = 16;
    const h = 8;
    const re = randomGrid(w * h, 3);
    const im = randomGrid(w * h, 4);
    const [wantRe, wantIm] = naiveDft2d(re, im, w, h);
    const fft = new Fft2d(w, h);
    const r = re.slice();
    const i = im.slice();
    fft.forward(r, i);
    for (let k = 0; k < w * h; k++) {
      expect(r[k]).toBeCloseTo(wantRe[k]!, 9);
      expect(i[k]).toBeCloseTo(wantIm[k]!, 9);
    }
    fft.inverse(r, i);
    for (let k = 0; k < w * h; k++) {
      expect(r[k]).toBeCloseTo(re[k]!, 12);
      expect(i[k]).toBeCloseTo(im[k]!, 12);
    }
  });

  it('splits one complex transform into the spectra of two real grids', () => {
    const w = 8;
    const h = 4;
    const a = randomGrid(w * h, 5);
    const b = randomGrid(w * h, 6);
    const zero = new Float64Array(w * h);
    const [aRe, aIm] = naiveDft2d(a, zero, w, h);
    const [bRe, bIm] = naiveDft2d(b, zero, w, h);
    const zRe = a.slice();
    const zIm = b.slice();
    new Fft2d(w, h).forward(zRe, zIm);
    const out = Array.from({ length: 4 }, () => new Float64Array(w * h));
    splitRealPair(w, h, zRe, zIm, out[0]!, out[1]!, out[2]!, out[3]!);
    for (let k = 0; k < w * h; k++) {
      expect(out[0]![k]).toBeCloseTo(aRe[k]!, 9);
      expect(out[1]![k]).toBeCloseTo(aIm[k]!, 9);
      expect(out[2]![k]).toBeCloseTo(bRe[k]!, 9);
      expect(out[3]![k]).toBeCloseTo(bIm[k]!, 9);
    }
  });
});
