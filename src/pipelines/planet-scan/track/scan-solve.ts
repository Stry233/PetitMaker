import { type FrameLines, type LatticePeriod, type RunProfiles, fitScanLattice, latticePins } from './lattice';
import { type EdgeList, type PathSolution, type PathSolveOptions, solvePath } from './path-solve';
import { SCAN_PROFILE } from '../profile';

// The scan's geometry in one solve: the camera path and the chunk lattice the ground's cells lie
// on. Later stages map cells into frames only through the model's `cellToTile` and `tileToCell`,
// so the lattice and the path cannot disagree.
//
// The mapping is the one the lattice was fitted under: a point `t` tile pixels from frame k's
// origin sits at path position pos[k] + t, and cell edges lie at phase + n * period / cells. It
// holds in every pin mode. With scale 1 it is the plain mosaic geometry. With scale s (the
// `scaled` mode) it places the plane of the region load lines, which define the cells, while
// the content the tracked shifts followed moves s tile pixels per path pixel between frames.

/** The lattice on one axis, in path coordinates. */
export interface AxisLatticeModel {
  /** One chunk, in path and tile pixels alike: the calibrated chunk size. */
  readonly period: number;
  /** The path solve divided the tracked shifts by this; 1 unless the pin mode is `scaled`. */
  readonly scale: number;
  /** Chunk lines sit at `phase + n * period`; phase in [0, period). Cell 0 starts at a line. */
  readonly phase: number;
  /** Located lines and their RMS and largest offset from the fitted lattice. */
  readonly lines: number;
  readonly residualRms: number;
  readonly residualMax: number;
}

/** A frame's position on the solved path: `path.x[k]`, `path.y[k]`. */
export interface FramePosition {
  readonly x: number;
  readonly y: number;
}

export interface LatticeModel {
  /** Cells per chunk on each axis. */
  readonly cells: number;
  readonly x: AxisLatticeModel | null;
  readonly y: AxisLatticeModel | null;
  /**
   * The point of cell coordinates (cellX, cellY) in the tile of the frame at `frame`, in
   * full-resolution rectified pixels from the tile's origin. Cell (i, j) spans [i, i + 1) by
   * [j, j + 1), so its centre is (i + 0.5, j + 0.5); cell 0 starts on a chunk line, so cell i
   * lies in chunk floor(i / cells). Throws when the lattice was not found on an axis.
   */
  cellToTile(cellX: number, cellY: number, frame: FramePosition): { x: number; y: number };
  /** The inverse of `cellToTile`: fractional cell coordinates of a tile point. */
  tileToCell(tileX: number, tileY: number, frame: FramePosition): { x: number; y: number };
}

export interface ScanSolution {
  readonly path: PathSolution;
  readonly lattice: LatticeModel;
}

function latticeModel(cells: number, x: AxisLatticeModel | null, y: AxisLatticeModel | null): LatticeModel {
  const need = (a: AxisLatticeModel | null, name: string): AxisLatticeModel => {
    if (!a) throw new Error(`the scan has no lattice on ${name}`);
    return a;
  };
  return {
    cells,
    x,
    y,
    cellToTile(cellX, cellY, frame) {
      const ax = need(x, 'x');
      const ay = need(y, 'y');
      return {
        x: ax.phase + (cellX * ax.period) / cells - frame.x,
        y: ay.phase + (cellY * ay.period) / cells - frame.y,
      };
    },
    tileToCell(tileX, tileY, frame) {
      const ax = need(x, 'x');
      const ay = need(y, 'y');
      return {
        x: ((tileX + frame.x - ax.phase) * cells) / ax.period,
        y: ((tileY + frame.y - ay.phase) * cells) / ay.period,
      };
    },
  };
}

/**
 * Solves the path from the tracked edges with the still runs' lattice pins and the kept frames' own
 * `lines` (`SCAN_PIN_MODE`, unless the eval names another mode in `options`), then fits the lattice
 * to every still run placed on that path.
 */
export function solveScan(
  frames: number, edges: EdgeList, runs: readonly RunProfiles[], options: PathSolveOptions = {}, lines?: FrameLines,
): ScanSolution {
  const calibrated: LatticePeriod = options.period ?? { x: SCAN_PROFILE.chunk.width, y: SCAN_PROFILE.chunk.height };
  const path = solvePath(frames, edges, latticePins(runs, calibrated, lines), { ...options, period: calibrated });
  const scale = { x: path.lattice.x?.scale ?? 1, y: path.lattice.y?.scale ?? 1 };
  const placed = runs.map((run) => ({ x: path.x[run.distinct]!, y: path.y[run.distinct]!, frames: run.frames, profiles: run.profiles }));
  const fit = fitScanLattice(placed, calibrated);
  const axis = (a: 'x' | 'y'): AxisLatticeModel | null => {
    const f = fit[a];
    if (!f) return null;
    return { period: calibrated[a], scale: scale[a], phase: f.phase, lines: f.lines, residualRms: f.residualRms, residualMax: f.residualMax };
  };
  return { path, lattice: latticeModel(SCAN_PROFILE.chunk.cells, axis('x'), axis('y')) };
}
