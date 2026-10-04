import { describe, expect, it } from 'vitest';
import { type RunProfiles, lineProfiles } from '../../../io/planet-scan/lattice';
import { EDGE_CLOSURE, EDGE_CONSECUTIVE, EdgeList } from '../../../io/planet-scan/path-solve';
import { SCAN_PROFILE } from '../../../io/planet-scan/profile';
import { solveScan } from '../../../io/planet-scan/scan-solve';
import { latticeDeviation, rasterPath, rng, toLine } from './synthetic';

const PX = SCAN_PROFILE.chunk.width;
const PY = SCAN_PROFILE.chunk.height;
const CELL = SCAN_PROFILE.cell;

describe('scan solve', () => {
  const raw = rasterPath(5, { x0: 0, x1: 1200, y0: 0, y1: 450 }, { x: 25.7, y: 22 }, 150);
  const truth = { x: raw.x.map((v) => v - raw.x[0]!), y: raw.y.map((v) => v - raw.y[0]!) };
  const n = truth.x.length;
  const origin = { x: 37.3, y: 51.9 };
  const runs: RunProfiles[] = [];
  for (let k = 0; k < n; k += 5) {
    runs.push({ distinct: k, frames: 12, profiles: lineProfiles(latticeDeviation(truth.x[k]!, truth.y[k]!, origin, 300 + k)) });
  }
  /** Edges from the truth with noise, every x shift read `stretch` times too long. */
  const edgesOf = (stretch: number) => {
    const r = rng(2);
    const noise = () => (r() * 2 - 1) * 0.2;
    const edges = new EdgeList();
    for (let k = 0; k + 1 < n; k++) edges.add(k, k + 1, (truth.x[k]! - truth.x[k + 1]!) * stretch + noise(), truth.y[k]! - truth.y[k + 1]! + noise(), 1, EDGE_CONSECUTIVE);
    for (let a = 0; a < n; a += 2) {
      for (let b = a + 4; b < n; b++) {
        if (Math.abs(truth.x[a]! - truth.x[b]!) < 300 && Math.abs(truth.y[a]! - truth.y[b]!) < 160) {
          edges.add(a, b, (truth.x[a]! - truth.x[b]!) * stretch + noise(), truth.y[a]! - truth.y[b]! + noise(), 1, EDGE_CLOSURE);
        }
      }
    }
    return edges;
  };

  it('returns the path and one lattice in its coordinates', () => {
    const { path, lattice } = solveScan(n, edgesOf(1), runs);
    expect(path.mode).toBe('pinned');
    expect(lattice.cells).toBe(SCAN_PROFILE.chunk.cells);
    expect(lattice.x!.period).toBe(PX);
    expect(lattice.x!.scale).toBe(1);
    expect(Math.abs(toLine(lattice.x!.phase, origin.x, PX))).toBeLessThan(0.1 * CELL.width);
    expect(Math.abs(toLine(lattice.y!.phase, origin.y, PY))).toBeLessThan(0.1 * CELL.height);
    expect(lattice.x!.residualRms).toBeLessThan(0.5);
  });

  it('places the lattice through a scale mismatch in scaled mode', () => {
    const { path, lattice } = solveScan(n, edgesOf(1.02), runs, { pins: 'scaled' });
    expect(lattice.x!.scale).toBeCloseTo(1.02, 2);
    expect(Math.abs(toLine(lattice.x!.phase, origin.x, PX))).toBeLessThan(0.1 * CELL.width);
    expect(lattice.x!.residualRms).toBeLessThan(0.5);
    let worst = 0;
    for (let k = 0; k < n; k++) worst = Math.max(worst, Math.abs(path.x[k]! - truth.x[k]!));
    expect(worst).toBeLessThan(1);
  });

  it('maps cells into every tile where its frame showed the chunk lines, in scaled mode', () => {
    const { path, lattice } = solveScan(n, edgesOf(1.02), runs, { pins: 'scaled' });
    const { cells } = lattice;
    for (const run of runs) {
      const k = run.distinct;
      const frame = { x: path.x[k]!, y: path.y[k]! };
      // The chunk line nearest the tile's centre, in cell units.
      const centre = lattice.tileToCell(SCAN_PROFILE.tile.width / 2, SCAN_PROFILE.tile.height / 2, frame);
      const line = { x: Math.round(centre.x / cells) * cells, y: Math.round(centre.y / cells) * cells };
      const at = lattice.cellToTile(line.x, line.y, frame);
      // The synthetic run drew its lines where truth + tile pixel sits on the lattice.
      expect(Math.abs(toLine(truth.x[k]! + at.x, origin.x, PX))).toBeLessThan(1);
      expect(Math.abs(toLine(truth.y[k]! + at.y, origin.y, PY))).toBeLessThan(1);
      const back = lattice.tileToCell(at.x, at.y, frame);
      expect(back.x).toBeCloseTo(line.x, 9);
      expect(back.y).toBeCloseTo(line.y, 9);
    }
    // Cell centres sit half a cell inside their cell.
    const c = lattice.cellToTile(0.5, 0.5, { x: 0, y: 0 });
    expect(c.x - lattice.x!.phase).toBeCloseTo(CELL.width / 2, 9);
    expect(c.y - lattice.y!.phase).toBeCloseTo(CELL.height / 2, 9);
  });

  it('refuses to map without a lattice on an axis', () => {
    const { lattice } = solveScan(n, edgesOf(1), []);
    expect(lattice.x).toBeNull();
    expect(() => lattice.cellToTile(0, 0, { x: 0, y: 0 })).toThrow(/no lattice/);
  });
});
