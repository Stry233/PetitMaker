import { describe, expect, it, vi } from 'vitest';

// Synchronous lattice fits over synthetic frames; seconds per case under a loaded or instrumented run.
vi.setConfig({ testTimeout: 60_000 });
import { fitComb, fitScanLattice, latticePins, lineProfiles, lineScratch, runLattice } from '../../../../pipelines/planet-scan/track/lattice';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import { latticeDeviation as deviationAt, rng, toLine } from '../synthetic';

const { width: TW, height: TH } = SCAN_PROFILE.tile;
const PX = SCAN_PROFILE.chunk.width;
const PY = SCAN_PROFILE.chunk.height;
const CELL = SCAN_PROFILE.cell;

const wrapDiff = (a: number, b: number, p: number) => Math.abs(toLine(a, b, p));

describe('chunk lattice', () => {
  const origin = { x: 37.3, y: 51.9 };

  it('fits a comb to a profile of sub-pixel lines', () => {
    const profile = Float64Array.from({ length: 700 }, (_, i) => Math.exp(-(toLine(i, 20.37, PX) ** 2) / 2));
    const fit = fitComb(profile, PX, SCAN_PROFILE.lattice.scan)!;
    expect(wrapDiff(fit.phase, 20.37, PX)).toBeLessThan(0.05);
    expect(fit.deviations.length).toBe(6);
    expect(fit.spread).toBeLessThan(0.1);
  });

  it('locates the lattice inside one still run', () => {
    let pinned = 0;
    for (let k = 0; k < 8; k++) {
      const x = 150 * k + 13.4;
      const y = 40 * k - 7.1;
      const seen = runLattice(lineProfiles(deviationAt(x, y, origin, 50 + k)));
      expect(seen.x).not.toBeNull();
      expect(seen.y).not.toBeNull();
      // The run sees a line at tile offset phase, so scan line x + phase lies on the lattice.
      expect(wrapDiff(x + seen.x!, origin.x, PX)).toBeLessThan(0.1 * CELL.width);
      expect(wrapDiff(y + seen.y!, origin.y, PY)).toBeLessThan(0.1 * CELL.height);
      pinned++;
    }
    expect(pinned).toBe(8);
  });

  it('reads every image alike through one set of reused scratch planes', () => {
    const scratch = lineScratch(TW * TH);
    for (let k = 0; k < 4; k++) {
      const image = deviationAt(150 * k + 13.4, 40 * k - 7.1, origin, 70 + k);
      expect(lineProfiles(image, 1, scratch)).toEqual(lineProfiles(image));
    }
    // A smaller image reads in the front of larger planes.
    const half = { width: TW >> 1, height: TH >> 1, data: Float32Array.from({ length: (TW >> 1) * (TH >> 1) }, (_, i) => (i % 37) / 37) };
    expect(lineProfiles(half, 2, scratch)).toEqual(lineProfiles(half, 2));
  });

  it('pins nothing on a run without animated lines', () => {
    const r = rng(3);
    const data = Float32Array.from({ length: TW * TH }, () => 0.4 * r());
    const seen = runLattice(lineProfiles({ width: TW, height: TH, data }));
    expect(seen).toEqual({ x: null, y: null });
  });

  it('recovers the scan lattice phase within a tenth of a cell from placed runs', () => {
    const r = rng(8);
    const runs = [];
    for (let k = 0; k < 30; k++) {
      const x = (k % 10) * 140 + r() * 20;
      const y = Math.floor(k / 10) * 160 + r() * 10;
      // Runs sit where the path solve put them, a few tenths of a pixel from the truth.
      const placedX = x + (r() * 2 - 1) * 0.3;
      const placedY = y + (r() * 2 - 1) * 0.3;
      runs.push({ x: placedX, y: placedY, frames: 6 + Math.floor(r() * 20), profiles: lineProfiles(deviationAt(x, y, origin, 200 + k)) });
    }
    const lattice = fitScanLattice(runs);
    expect(lattice.period).toEqual({ x: PX, y: PY });
    expect(wrapDiff(lattice.x!.phase, origin.x, PX)).toBeLessThan(0.1 * CELL.width);
    expect(wrapDiff(lattice.y!.phase, origin.y, PY)).toBeLessThan(0.1 * CELL.height);
    expect(lattice.x!.lines).toBeGreaterThanOrEqual(13);
    expect(lattice.y!.lines).toBeGreaterThanOrEqual(5);
    expect(lattice.x!.residualRms).toBeLessThan(0.5);
    expect(lattice.y!.residualRms).toBeLessThan(0.5);
  });

  it('pins only still runs long enough to place the lattice', () => {
    const min = SCAN_PROFILE.latticeMinFrames;
    const runs = [0, 1, 2].map((k) => ({
      distinct: 10 * k,
      frames: k === 1 ? min - 1 : min + k,
      profiles: lineProfiles(deviationAt(150 * k, 20 * k, origin, 90 + k)),
    }));
    const pins = latticePins(runs);
    expect(Array.from(pins.x.frame)).toEqual([0, 20]);
    expect(Array.from(pins.y.frame)).toEqual([0, 20]);
    expect(wrapDiff(pins.x.phase[1]! + 300, origin.x, PX)).toBeLessThan(0.1 * CELL.width);
  });

  it('adds each other kept frame\'s own lines as moving pins', () => {
    const min = SCAN_PROFILE.latticeMinFrames;
    const runs = [{ distinct: 1, frames: min, profiles: lineProfiles(deviationAt(0, 0, origin, 91)) }];
    const lines = { x: [5, 6, Number.NaN, 8], y: [Number.NaN, 2, 3, Number.NaN] };
    const pins = latticePins(runs, undefined, lines);
    // Frame 1 is the still run's; its own line reading is not added again.
    expect(Array.from(pins.x.frame)).toEqual([1, 0, 3]);
    expect(Array.from(pins.x.moving!)).toEqual([0, 1, 1]);
    expect(Array.from(pins.x.phase.subarray(1))).toEqual([5, 8]);
    expect(Array.from(pins.y.frame)).toEqual([1, 2]);
    expect(latticePins(runs).x.moving).toBeUndefined();
  });

  it('keeps a frame\'s own line on an axis its still run did not read', () => {
    const min = SCAN_PROFILE.latticeMinFrames;
    const read = lineProfiles(deviationAt(0, 0, origin, 92));
    const runs = [{ distinct: 1, frames: min, profiles: { ...read, y: new Float32Array(read.y.length) } }];
    expect(runLattice(runs[0]!.profiles)).toMatchObject({ y: null });
    const pins = latticePins(runs, undefined, { x: [Number.NaN, 6], y: [Number.NaN, 2] });
    expect(Array.from(pins.x.frame)).toEqual([1]);
    expect(Array.from(pins.y.frame)).toEqual([1]);
    expect(Array.from(pins.y.moving!)).toEqual([1]);
  });
});
