import { describe, expect, it } from 'vitest';
import { PhaseCorrelator, highPass, overlapNcc } from '../../../../pipelines/planet-scan/track/phase-correlate';
import { broadbandField, rng } from '../synthetic';

// Half-resolution rectified tiles, the size tracking correlates.
const W = 340;
const H = 150;

describe('phase correlation', () => {
  const view = broadbandField(7);
  const correlator = new PhaseCorrelator(W, H);

  it('pads tiles to powers of two', () => {
    expect([correlator.paddedWidth, correlator.paddedHeight]).toEqual([512, 256]);
  });

  it('peaks at 1 with no shift for identical tiles', () => {
    const a = view(0, 0, { width: W, height: H });
    const est = correlator.estimate(a, a)!;
    expect(est.dx).toBeCloseTo(0, 6);
    expect(est.dy).toBeCloseTo(0, 6);
    expect(est.response).toBeCloseTo(1, 6);
    expect(est.ncc).toBeCloseTo(1, 6);
  });

  it('recovers integer shifts in both directions', () => {
    for (const [dx, dy] of [[0, 0], [17, -9], [-60, 23], [95, 40], [-3, -41]] as const) {
      const est = correlator.estimate(view(0, 0, { width: W, height: H }, 2, 1), view(dx, dy, { width: W, height: H }, 2, 2))!;
      expect(Math.abs(est.dx - dx)).toBeLessThan(0.05);
      expect(Math.abs(est.dy - dy)).toBeLessThan(0.05);
      expect(est.ncc).toBeGreaterThan(0.8);
    }
  });

  it('recovers half-pixel shifts', () => {
    for (const [dx, dy] of [[12.5, -3.5], [-0.5, 0.5], [30.5, 7]] as const) {
      const est = correlator.estimate(view(0, 0, { width: W, height: H }, 2, 3), view(dx, dy, { width: W, height: H }, 2, 4))!;
      expect(Math.abs(est.dx - dx)).toBeLessThan(0.05);
      expect(Math.abs(est.dy - dy)).toBeLessThan(0.05);
    }
  });

  it('recovers random sub-pixel shifts without bias', () => {
    const r = rng(3);
    const errX: number[] = [];
    const errY: number[] = [];
    for (let t = 0; t < 30; t++) {
      const dx = (r() * 2 - 1) * 60;
      const dy = (r() * 2 - 1) * 30;
      const est = correlator.estimate(view(0, 0, { width: W, height: H }, 2, 10 + 2 * t), view(dx, dy, { width: W, height: H }, 2, 11 + 2 * t))!;
      errX.push(est.dx - dx);
      errY.push(est.dy - dy);
    }
    const mean = (v: number[]) => v.reduce((s, e) => s + e, 0) / v.length;
    expect(Math.max(...errX.map(Math.abs), ...errY.map(Math.abs))).toBeLessThan(0.05);
    expect(Math.abs(mean(errX))).toBeLessThan(0.01);
    expect(Math.abs(mean(errY))).toBeLessThan(0.01);
  });

  it('verifies candidates so a periodic alias with the higher peak loses to the true shift', () => {
    // Ground repeating every 64 px with faint unique content: the alias 64 px short of the true
    // shift overlaps more of the window and outranks it on the surface.
    const periodic = broadbandField(11, 64, 256);
    const unique = broadbandField(12);
    const frame = (dx: number, dy: number, seed: number) => {
      const p = periodic(dx, dy, { width: W, height: H }, 1, seed);
      const u = unique(dx, dy, { width: W, height: H });
      for (let i = 0; i < p.data.length; i++) p.data[i]! += 0.1 * u.data[i]!;
      return p;
    };
    const a = frame(0, 0, 1);
    const b = frame(100, 3.3, 2);
    const candidates = correlator.correlate(a, b);
    expect(candidates[0]).toMatchObject({ dx: 36 - 64, dy: 3 });
    expect(candidates.some((c) => c.dx === 100)).toBe(true);
    const est = correlator.estimate(a, b)!;
    expect(est.rank).toBeGreaterThan(0);
    expect(Math.abs(est.dx - 100)).toBeLessThan(0.05);
    expect(Math.abs(est.dy - 3.3)).toBeLessThan(0.05);
  });

  it('returns no match when the overlap is too small to verify', () => {
    expect(correlator.estimate(view(0, 0, { width: W, height: H }, 2, 1), view(220, 0, { width: W, height: H }, 2, 2))).toBeNull();
  });

  it('returns no match for unrelated tiles', () => {
    const other = broadbandField(99);
    expect(correlator.estimate(view(0, 0, { width: W, height: H }), other(0, 0, { width: W, height: H }))).toBeNull();
  });

  it('refines from a neighbouring integer to the same sub-pixel peak', () => {
    correlator.correlate(view(0, 0, { width: W, height: H }), view(20.3, -7.6, { width: W, height: H }));
    for (const [sx, sy] of [[20, -8], [21, -7], [20, -7]] as const) {
      const fine = correlator.refine(sx, sy);
      expect(fine.dx).toBeCloseTo(20.3, 1);
      expect(fine.dy).toBeCloseTo(-7.6, 1);
    }
  });
});

describe('overlap correlation', () => {
  it('scores an exact shifted copy as 1 over the overlap', () => {
    const view = broadbandField(5);
    const a = view(0, 0, { width: W, height: H });
    const b = view(30, -12, { width: W, height: H });
    const v = overlapNcc(a, b, { dx: 30, dy: -12 });
    expect(v.ncc).toBeCloseTo(1, 4);
    expect(v.overlap).toBeCloseTo(((W - 30) * (H - 12)) / (W * H), 9);
  });

  it('refuses overlaps below the minimum size', () => {
    const a = { width: W, height: H, data: new Float32Array(W * H) };
    expect(overlapNcc(a, a, { dx: W - 20, dy: 0 }, 40, 10)).toEqual({ ncc: -1, overlap: 0 });
  });
});

describe('high-pass', () => {
  it('removes constants and linear gradients away from the edges', () => {
    const w = 120;
    const h = 80;
    const src = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = 90 + 0.7 * x - 0.4 * y;
    const out = highPass({ width: w, height: h, data: src }, 6).data;
    for (let y = 20; y < h - 20; y++) for (let x = 20; x < w - 20; x++) expect(Math.abs(out[y * w + x]!)).toBeLessThan(1e-3);
  });

  it('keeps fine texture', () => {
    const w = 64;
    const h = 64;
    const src = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = 100 + ((x + y) % 2 ? 10 : -10);
    const out = highPass({ width: w, height: h, data: src }, 6).data;
    expect(out[32 * w + 32]).toBeCloseTo(-10, 1);
    expect(out[32 * w + 33]).toBeCloseTo(10, 1);
  });
});
