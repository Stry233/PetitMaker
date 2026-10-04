import { describe, expect, it } from 'vitest';
import { EDGE_CLOSURE, EDGE_CONSECUTIVE, EDGE_GATED, EdgeList, SCALE_MIN_PINS, SOURCE_ASSUMED, solvePath } from '../../../io/planet-scan/path-solve';
import { SCAN_PROFILE } from '../../../io/planet-scan/profile';
import { rasterPath, rng } from './synthetic';

const PERIOD = { x: SCAN_PROFILE.chunk.width, y: SCAN_PROFILE.chunk.height };

/** A full-resolution raster scan: 25.7 by 22 pixel camera quanta, rows 150 pixels apart. */
function scan(seed: number) {
  const path = rasterPath(seed, { x0: 0, x1: 1500, y0: 0, y1: 600 }, { x: 25.7, y: 22 }, 150);
  const x0 = path.x[0]!;
  const y0 = path.y[0]!;
  return { x: path.x.map((v) => v - x0), y: path.y.map((v) => v - y0) };
}

/** Consecutive edges from the truth with noise, their x steps read `stretch` times too long, plus
 *  closures between frames whose tiles overlap, only between rows when `crossRow` is set and
 *  stretched too when `stretchClosures` is. */
function edgesOf(truth: { x: number[]; y: number[] }, seed: number, stretch = 1, crossRow = false, stretchClosures = false): EdgeList {
  const r = rng(seed);
  const noise = (a: number) => (r() * 2 - 1) * a;
  const edges = new EdgeList();
  const n = truth.x.length;
  for (let k = 0; k + 1 < n; k++) {
    const dx = (truth.x[k]! - truth.x[k + 1]!) * stretch + noise(0.2);
    const dy = truth.y[k]! - truth.y[k + 1]! + noise(0.2);
    edges.add(k, k + 1, dx, dy, 1, EDGE_CONSECUTIVE);
  }
  // As tracking picks them: every second frame, the six later frames overlapping it most.
  for (let a = 0; a < n; a += 2) {
    const overlap = (b: number) =>
      (Math.max(0, 680 - Math.abs(truth.x[a]! - truth.x[b]!)) * Math.max(0, 300 - Math.abs(truth.y[a]! - truth.y[b]!))) / (680 * 300);
    const later = Array.from({ length: Math.max(0, n - a - 4) }, (_, i) => a + 4 + i).filter((b) => overlap(b) >= 0.35 && (!crossRow || Math.abs(truth.y[a]! - truth.y[b]!) > 100));
    later.sort((p, q) => overlap(q) - overlap(p) || p - q);
    for (const b of later.slice(0, 6)) {
      const ex = (truth.x[a]! - truth.x[b]!) * (stretchClosures ? stretch : 1);
      const ey = truth.y[a]! - truth.y[b]!;
      edges.add(a, b, ex + noise(0.3), ey + noise(0.3), 1, EDGE_CLOSURE);
    }
  }
  return edges;
}

function maxError(sol: { x: Float64Array; y: Float64Array }, truth: { x: number[]; y: number[] }): number {
  let m = 0;
  for (let k = 0; k < truth.x.length; k++) m = Math.max(m, Math.hypot(sol.x[k]! - truth.x[k]!, sol.y[k]! - truth.y[k]!));
  return m;
}

describe('path solve', () => {
  const truth = scan(5);

  it('recovers a noisy raster path within a pixel, frame 0 at the origin', () => {
    const sol = solvePath(truth.x.length, edgesOf(truth, 1));
    expect(sol.x[0]).toBeCloseTo(0, 9);
    expect(sol.y[0]).toBeCloseTo(0, 9);
    expect(maxError(sol, truth)).toBeLessThan(1);
    expect(sol.rejected).toBe(0);
  });

  it('rejects a false closure and keeps the path', () => {
    const edges = edgesOf(truth, 2);
    const a = 10;
    const b = truth.x.findIndex((_, k) => k > a + 20 && Math.abs(truth.x[k]! - truth.x[a]!) < 100);
    expect(b).toBeGreaterThan(0);
    // An alias 20 pixels off: inside the tracking gate, so only the solve can reject it.
    edges.add(a, b, truth.x[a]! - truth.x[b]! + 20, truth.y[a]! - truth.y[b]! - 4, 1, EDGE_CLOSURE);
    const sol = solvePath(truth.x.length, edges);
    expect(sol.weightX[edges.count - 1]).toBe(SCAN_PROFILE.tracking.solve.outlierWeight);
    expect(sol.rejected).toBe(1);
    expect(maxError(sol, truth)).toBeLessThan(1);
  });

  it('is deterministic', () => {
    const one = solvePath(truth.x.length, edgesOf(truth, 3));
    const two = solvePath(truth.x.length, edgesOf(truth, 3));
    expect(Array.from(one.x)).toEqual(Array.from(two.x));
    expect(Array.from(one.y)).toEqual(Array.from(two.y));
  });

  it('pulls a chain with a mis-measured sweep length onto the lattice its still runs saw', () => {
    // Steps read 2% long on x and revisits only join rows, which a serpentine scan's stretch
    // leaves nearly consistent, so closures barely see it.
    const edges = edgesOf(truth, 4, 1.02, true);
    const n = truth.x.length;
    const origin = { x: 37.3, y: 51.9 };
    const r = rng(9);
    const pinsOf = (axis: 'x' | 'y') => {
      const frame: number[] = [];
      const phase: number[] = [];
      for (let k = 0; k < n; k += 3) {
        const p = PERIOD[axis];
        frame.push(k);
        phase.push((((origin[axis] - truth[axis][k]!) % p) + p) % p + (r() * 2 - 1) * 0.2);
      }
      // A still run whose lines were misread by a third of a period.
      phase[5] = (phase[5]! + PERIOD[axis] / 3) % PERIOD[axis];
      return { frame: Int32Array.from(frame), phase: Float64Array.from(phase) };
    };
    const free = solvePath(n, edges);
    expect(maxError(free, truth)).toBeGreaterThan(3);

    const sol = solvePath(n, edges, { x: pinsOf('x'), y: pinsOf('y') });
    expect(maxError(sol, truth)).toBeLessThan(1);
    expect(sol.lattice.x!.origin).toBeCloseTo(origin.x, 0);
    expect(Math.abs(sol.lattice.y!.origin - origin.y)).toBeLessThan(0.3);
    expect(sol.lattice.x!.rmsBefore).toBeGreaterThan(3);
    expect(sol.lattice.x!.rmsAfter).toBeLessThan(0.5);
    expect(sol.lattice.x!.accepted).toBe(sol.lattice.x!.pins - 1);
  });

  it('keeps a pin read off an alias half a period away out of the first pinned round', () => {
    // Consecutive edges only, so nothing but the robust rounds can undo what the first round bends.
    const n = truth.x.length;
    const r = rng(3);
    const edges = new EdgeList();
    for (let k = 0; k + 1 < n; k++) {
      edges.add(k, k + 1, truth.x[k]! - truth.x[k + 1]! + (r() - 0.5) * 0.4, truth.y[k]! - truth.y[k + 1]! + (r() - 0.5) * 0.4, 1, EDGE_CONSECUTIVE);
    }
    const pinsOf = (axis: 'x' | 'y') => {
      const frame: number[] = [];
      const phase: number[] = [];
      const p = PERIOD[axis];
      for (let k = 0; k < n; k += 4) {
        frame.push(k);
        phase.push((((10 - truth[axis][k]!) % p) + p) % p + (r() - 0.5) * 0.4);
      }
      phase[20] = (phase[20]! + p / 2) % p;
      return { frame: Int32Array.from(frame), phase: Float64Array.from(phase) };
    };
    const pins = { x: pinsOf('x'), y: pinsOf('y') };
    const sol = solvePath(n, edges, pins);
    expect(maxError(sol, truth)).toBeLessThan(1);
    expect(sol.rejected).toBe(0);
    expect(sol.lattice.x!.accepted).toBe(sol.lattice.x!.pins - 1);
    // Taking every pin in the first round bends the path and drops true edges for good.
    const every = solvePath(n, edges, pins, { pinFirstReject: 1 });
    expect(maxError(every, truth)).toBeGreaterThan(10);
  });

  /** Pins every third frame from the truth, with noise, one of them misread. */
  function truthPins(seed: number, origin: { x: number; y: number }) {
    const n = truth.x.length;
    const r = rng(seed);
    const of = (axis: 'x' | 'y') => {
      const frame: number[] = [];
      const phase: number[] = [];
      const p = PERIOD[axis];
      for (let k = 0; k < n; k += 3) {
        frame.push(k);
        phase.push((((origin[axis] - truth[axis][k]!) % p) + p) % p + (r() * 2 - 1) * 0.2);
      }
      phase[5] = (phase[5]! + p / 3) % p;
      return { frame: Int32Array.from(frame), phase: Float64Array.from(phase) };
    };
    return { x: of('x'), y: of('y') };
  }

  describe('pin modes', () => {
    // Every shift reads 2% long on x: the tracked motion and the calibrated period disagree.
    const edges = edgesOf(truth, 6, 1.02, false, true);
    const n = truth.x.length;
    const pins = truthPins(10, { x: 37.3, y: 51.9 });

    it('measures the scale mismatch on the unpinned path in every mode', () => {
      for (const mode of ['pinned', 'light', 'scaled', 'unpinned'] as const) {
        const sol = solvePath(n, edges, pins, { pins: mode });
        expect(sol.mode).toBe(mode);
        // Lines every P tile pixels sit every 1.02 P tracked pixels: slope 1 - 1 / 1.02.
        expect(sol.lattice.x!.slope).toBeCloseTo(1 - 1 / 1.02, 3);
        expect(Math.abs(sol.lattice.y!.slope)).toBeLessThan(5e-4);
        expect(sol.lattice.x!.rmsBefore).toBeGreaterThan(5);
      }
    });

    it('divides the scale out of the tracked shifts in scaled mode', () => {
      const sol = solvePath(n, edges, pins, { pins: 'scaled' });
      expect(sol.lattice.x!.scale).toBeCloseTo(1.02, 3);
      expect(sol.lattice.y!.scale).toBeCloseTo(1, 3);
      expect(maxError(sol, truth)).toBeLessThan(1);
      expect(sol.rejectedConsecutive).toBe(0);
      expect(sol.lattice.x!.rmsAfter).toBeLessThan(0.3);
    });

    it('keeps scale 1 on an axis with too few pins', () => {
      const few = { frame: pins.x.frame.subarray(0, SCALE_MIN_PINS - 1), phase: pins.x.phase.subarray(0, SCALE_MIN_PINS - 1) };
      const sol = solvePath(n, edges, { x: few, y: pins.y }, { pins: 'scaled' });
      expect(sol.lattice.x!.scale).toBe(1);
      expect(sol.lattice.x!.scaleFitted).toBe(false);
      expect(sol.lattice.y!.scaleFitted).toBe(true);
    });

    it('keeps the scale and compromises between edges and pins when pinned', () => {
      const pinned = solvePath(n, edges, pins, { pins: 'pinned' });
      const scaled = solvePath(n, edges, pins, { pins: 'scaled' });
      expect(pinned.lattice.x!.scale).toBe(1);
      expect(pinned.edgeResidual).toBeGreaterThan(scaled.edgeResidual);
      expect(maxError(pinned, truth)).toBeGreaterThan(maxError(scaled, truth));
    });

    it('leaves the path to the edges when unpinned', () => {
      const free = solvePath(n, edges, {}, {});
      const unpinned = solvePath(n, edges, pins, { pins: 'unpinned' });
      expect(Array.from(unpinned.x)).toEqual(Array.from(free.x));
      expect(unpinned.lattice.x!.rmsAfter).toBe(unpinned.lattice.x!.rmsBefore);
    });

    it('weighs pins less in light mode', () => {
      const pinned = solvePath(n, edges, pins, { pins: 'pinned' });
      const light = solvePath(n, edges, pins, { pins: 'light' });
      expect(light.lattice.x!.rmsAfter).toBeGreaterThan(pinned.lattice.x!.rmsAfter);
    });
  });

  it('reports an assumed step no matched path spans', () => {
    const edges = new EdgeList();
    edges.add(0, 1, -10, 0, 1, EDGE_CONSECUTIVE);
    edges.add(1, 2, -10, 0, SCAN_PROFILE.tracking.solve.outlierWeight, EDGE_CONSECUTIVE, SOURCE_ASSUMED);
    edges.add(2, 3, -10, 0, 1, EDGE_CONSECUTIVE);
    const split = solvePath(4, edges);
    expect(Array.from(split.unbridged)).toEqual([1]);
    expect(Array.from(split.matchedPart)).toEqual([0, 0, 1, 1]);
    // A revisit from frame 0 to frame 3 spans it.
    edges.add(0, 3, -31, 0, 1, EDGE_CLOSURE);
    const sol = solvePath(4, edges);
    expect(Array.from(sol.unbridged)).toEqual([]);
    expect(Array.from(sol.matchedPart)).toEqual([0, 0, 0, 0]);
    expect(sol.x[2]).toBeCloseTo(21, 0);
  });

  it('reports gated revisits and leaves them out of the solve', () => {
    const edges = new EdgeList();
    edges.add(0, 1, -10, 0, 1, EDGE_CONSECUTIVE);
    edges.add(1, 2, -10, 0, 1, EDGE_CONSECUTIVE);
    edges.add(0, 2, 100, 0, 0, EDGE_GATED);
    const sol = solvePath(3, edges);
    expect(Array.from(sol.gated)).toEqual([2]);
    expect(sol.x[2]).toBeCloseTo(20, 6);
    expect(sol.rejected).toBe(0);
  });

  it('refuses a path graph in two parts', () => {
    const edges = new EdgeList();
    edges.add(0, 1, 1, 0, 1, EDGE_CONSECUTIVE);
    edges.add(2, 3, 1, 0, 1, EDGE_CONSECUTIVE);
    expect(() => solvePath(4, edges)).toThrow(/disconnected/);
  });
});
