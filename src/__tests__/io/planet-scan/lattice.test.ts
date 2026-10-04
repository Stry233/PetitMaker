import { describe, expect, it } from 'vitest';
import { fitComb, fitScanLattice, latticePins, lineProfiles, runLattice } from '../../../io/planet-scan/lattice';
import { SCAN_PROFILE } from '../../../io/planet-scan/profile';
import { latticeDeviation as deviationAt, rng, toLine } from './synthetic';

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
});
