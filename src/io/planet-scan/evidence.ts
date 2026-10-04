import { lightness, lutIndex, positionWeights, saturation, toLab, GRASS, SEA } from './colour';
import { ScanError } from './errors';
import { PREVIEW_GRASS, PREVIEW_SAND, PREVIEW_SEA, PreviewGrid, previewMerge, type ScanPreview } from './preview';
import { SCAN_PROFILE } from './profile';
import type { FramePosition, LatticeModel } from './scan-solve';
import type { GreyImage, RgbaImage } from './types';

// Per-cell evidence of the ground, streamed from the distinct frames once the path and the lattice
// are solved. Cells are placed in a frame's tile only through the lattice model's `cellToTile` and
// `tileToCell`.
//
// Each cell is sampled at `subsamples` x `subsamples` points (the centres of equal sub-cells) in
// every frame that sees it. A sample is the frame's bilinear colour there, weighted by the tile
// position's weight (`SCAN_PROFILE.evidence.weight`): the view's edges are blurred by depth of
// field. Per sample point the evidence sums the weight, the sea and grass votes of the palette's
// pixel classes and the lightness; at 5 x 5 a cell's inner area (`SCAN_PROFILE.evidence.inner`) is its central 3 x 3 points. Per cell
// it sums, at the centre point, the L*a*b* colour, the HSV saturation and the lightness over
// the trusted positions (for its temporal deviation); over the inner area, the L*a*b* colour; and
// at the centre, the temporal deviation of the still runs placed on the path (the animation of
// foam and region load lines).
//
// Memory: four float32 planes per sample point (400 bytes a cell at 5 x 5) and about 70 bytes of
// per-cell sums, about 17 MB for a 12 x 12-chunk scan and at most 57 MB at the grid cap of
// `SCAN_PROFILE.evidence.maxChunks` chunks a side. Frames are read and never kept; the still runs'
// deviation images are kept reduced (`reduceDeviation`, 51 KB a run at half resolution) until the
// path places them.

const E = SCAN_PROFILE.evidence;
const G = SCAN_PROFILE.ground;
const S = E.subsamples;
const CENTRE = S >> 1;

/**
 * The weight of each of a cell axis's `sub` sample points in the central `share` of the side: 1
 * for a point whose sub-cell lies inside, the covered fraction for one the boundary cuts, 0
 * outside. A cell's area weight is the product of its two axes'.
 */
export function areaWeights(sub: number, share: number): Float64Array {
  const w = new Float64Array(sub);
  for (let s = 0; s < sub; s++) w[s] = Math.max(0, Math.min(1, (share / 2 - Math.abs((s + 0.5) / sub - 0.5)) * sub + 0.5));
  return w;
}

/** The inner area's weight per sample point of an axis. */
const INNER = areaWeights(S, E.inner);

/** The cells the evidence covers: lattice cells [cellX0, cellX0 + cols) x [cellY0, cellY0 + rows),
 *  with cellX0 and cellY0 on chunk lines and whole chunks on each axis. */
export interface EvidenceGrid {
  readonly cellX0: number;
  readonly cellY0: number;
  readonly cols: number;
  readonly rows: number;
}

/** The whole chunks every frame's tile of `width` x `height` pixels touches. */
export function evidenceGrid(lattice: LatticeModel, positions: readonly FramePosition[], width: number, height: number): EvidenceGrid {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const at of positions) {
    for (const [tx, ty] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]] as const) {
      const c = lattice.tileToCell(tx, ty, at);
      x0 = Math.min(x0, c.x);
      y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x);
      y1 = Math.max(y1, c.y);
    }
  }
  if (!(x1 >= x0 && y1 >= y0)) throw new Error('the evidence grid needs at least one frame');
  const n = lattice.cells;
  const cellX0 = Math.floor(Math.floor(x0) / n) * n;
  const cellY0 = Math.floor(Math.floor(y0) / n) * n;
  const cols = (Math.floor(Math.floor(x1) / n) + 1) * n - cellX0;
  const rows = (Math.floor(Math.floor(y1) / n) + 1) * n - cellY0;
  if (cols > E.maxChunks * n || rows > E.maxChunks * n) throw new ScanError('too-large');
  return { cellX0, cellY0, cols, rows };
}

/** A still run's temporal deviation at reduced resolution: pixel j covers tile pixels
 *  [j * step, (j + 1) * step) on each axis, as bytes of `scale` steps per grey level. */
export interface ReducedDeviation {
  readonly width: number;
  readonly height: number;
  readonly step: number;
  readonly scale: number;
  readonly data: Uint8Array;
}

/** Box-reduces a still run's deviation image for keeping until the path is solved. */
export function reduceDeviation(deviation: GreyImage, step: number = E.deviationStep, scale: number = E.deviationScale): ReducedDeviation {
  const width = Math.floor(deviation.width / step);
  const height = Math.floor(deviation.height / step);
  const data = new Uint8Array(width * height);
  const src = deviation.data;
  const area = step * step;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = 0; dy < step; dy++) {
        const row = (y * step + dy) * deviation.width + x * step;
        for (let dx = 0; dx < step; dx++) sum += src[row + dx]!;
      }
      data[y * width + x] = Math.min(255, Math.round((sum / area) * scale));
    }
  }
  return { width, height, step, scale, data };
}

/** The evidence of every cell of a grid, as means. */
export interface CellEvidence {
  readonly grid: EvidenceGrid;
  /** Sample points per cell axis. */
  readonly sub: number;
  /** The sample-point raster: `cols * sub` by `rows * sub`, row-major. Point (i, j) of cell
   *  (c, r) is raster cell (c * sub + i, r * sub + j), at cell coordinates ((i + 0.5) / sub,
   *  (j + 0.5) / sub) from the cell's corner. */
  readonly points: {
    readonly width: number;
    readonly height: number;
    /** Accumulated position weight. */
    readonly weight: Float32Array;
    /** Sea and grass vote shares; an unseen point reads as all sea and no grass. */
    readonly sea: Float32Array;
    readonly grass: Float32Array;
    /** Mean lightness; 0 where unseen. */
    readonly lightness: Float32Array;
  };
  /** Per cell at its centre point: accumulated weight, mean L*a*b*, saturation (0..255), the
   *  temporal standard deviation of lightness over trusted positions, and the mean still-run
   *  deviation in grey levels; each 0 where unseen. */
  readonly weight: Float32Array;
  readonly lab: { readonly l: Float32Array; readonly a: Float32Array; readonly b: Float32Array };
  readonly saturation: Float32Array;
  readonly lightnessDeviation: Float32Array;
  readonly animation: Float32Array;
  /** Per cell, the mean L*a*b* over its inner area (`SCAN_PROFILE.evidence.inner`), and that
   *  area's weight. */
  readonly inner: { readonly weight: Float32Array; readonly l: Float32Array; readonly a: Float32Array; readonly b: Float32Array };
}

/** Accumulates the evidence of a grid from rectified RGBA tiles and reduced still-run deviations. */
export class EvidenceAccumulator {
  private readonly pw: number;
  private readonly ph: number;
  private readonly pWeight: Float32Array;
  private readonly pSea: Float32Array;
  private readonly pGrass: Float32Array;
  private readonly pLight: Float32Array;
  private readonly cWeight: Float32Array;
  private readonly cL: Float32Array;
  private readonly cA: Float32Array;
  private readonly cB: Float32Array;
  private readonly cSat: Float32Array;
  private readonly tCount: Float32Array;
  private readonly tSum: Float64Array;
  private readonly tSq: Float64Array;
  private readonly iWeight: Float32Array;
  private readonly iL: Float32Array;
  private readonly iA: Float32Array;
  private readonly iB: Float32Array;
  private readonly aSum: Float32Array;
  private readonly aWeight: Float32Array;
  private readonly wx: Float32Array;
  private readonly wy: Float32Array;
  private readonly lab = new Float64Array(3);
  private finished = false;

  /**
   * @param lut the palette's class of every quantised colour (`colour.ts:lutIndex`)
   * @param width tile width in pixels, as every pushed tile has it
   */
  constructor(
    readonly grid: EvidenceGrid,
    private readonly lattice: LatticeModel,
    private readonly lut: Uint8Array,
    readonly width: number,
    readonly height: number,
  ) {
    this.pw = grid.cols * S;
    this.ph = grid.rows * S;
    const points = this.pw * this.ph;
    const cells = grid.cols * grid.rows;
    this.pWeight = new Float32Array(points);
    this.pSea = new Float32Array(points);
    this.pGrass = new Float32Array(points);
    this.pLight = new Float32Array(points);
    this.cWeight = new Float32Array(cells);
    this.cL = new Float32Array(cells);
    this.cA = new Float32Array(cells);
    this.cB = new Float32Array(cells);
    this.cSat = new Float32Array(cells);
    this.tCount = new Float32Array(cells);
    this.tSum = new Float64Array(cells);
    this.tSq = new Float64Array(cells);
    this.iWeight = new Float32Array(cells);
    this.iL = new Float32Array(cells);
    this.iA = new Float32Array(cells);
    this.iB = new Float32Array(cells);
    this.aSum = new Float32Array(cells);
    this.aWeight = new Float32Array(cells);
    const w = positionWeights(width, height);
    this.wx = w.x;
    this.wy = w.y;
  }

  /** The grid cells a frame's tile touches: [x0, x1) x [y0, y1), clamped to the grid. */
  private cellRange(at: FramePosition): { x0: number; y0: number; x1: number; y1: number } {
    let lx = Infinity;
    let ly = Infinity;
    let hx = -Infinity;
    let hy = -Infinity;
    for (const [tx, ty] of [[0, 0], [this.width - 1, 0], [0, this.height - 1], [this.width - 1, this.height - 1]] as const) {
      const c = this.lattice.tileToCell(tx, ty, at);
      lx = Math.min(lx, c.x);
      ly = Math.min(ly, c.y);
      hx = Math.max(hx, c.x);
      hy = Math.max(hy, c.y);
    }
    const { cellX0, cellY0, cols, rows } = this.grid;
    return {
      x0: Math.max(0, Math.floor(lx) - cellX0),
      y0: Math.max(0, Math.floor(ly) - cellY0),
      x1: Math.min(cols, Math.floor(hx) + 1 - cellX0),
      y1: Math.min(rows, Math.floor(hy) + 1 - cellY0),
    };
  }

  /** Folds in one distinct frame's rectified RGBA tile at its solved position. */
  addFrame(tile: RgbaImage, at: FramePosition): void {
    if (this.finished) throw new Error('the evidence is finished');
    if (tile.width !== this.width || tile.height !== this.height) throw new Error(`evidence expects ${this.width}x${this.height} tiles`);
    const { width: W, height: H } = this;
    const d = tile.data;
    const { cellX0, cellY0, cols } = this.grid;
    const range = this.cellRange(at);
    const { pw, lut, wx, wy, lab } = this;
    for (let gy = range.y0; gy < range.y1; gy++) {
      for (let gx = range.x0; gx < range.x1; gx++) {
        const X = cellX0 + gx;
        const Y = cellY0 + gy;
        const o = this.lattice.cellToTile(X, Y, at);
        const ox = this.lattice.cellToTile(X + 1, Y, at);
        const oy = this.lattice.cellToTile(X, Y + 1, at);
        const exx = ox.x - o.x;
        const exy = ox.y - o.y;
        const eyx = oy.x - o.x;
        const eyy = oy.y - o.y;
        const cell = gy * cols + gx;
        for (let sy = 0; sy < S; sy++) {
          const fy = (sy + 0.5) / S;
          for (let sx = 0; sx < S; sx++) {
            const fx = (sx + 0.5) / S;
            const px = o.x + fx * exx + fy * eyx;
            const py = o.y + fx * exy + fy * eyy;
            if (!(px >= 0 && py >= 0 && px <= W - 1 && py <= H - 1)) continue;
            const ix = Math.min(W - 2, Math.floor(px));
            const iy = Math.min(H - 2, Math.floor(py));
            const ax = px - ix;
            const ay = py - iy;
            const i00 = (iy * W + ix) * 4;
            const i10 = i00 + 4;
            const i01 = i00 + W * 4;
            const i11 = i01 + 4;
            const w00 = (1 - ax) * (1 - ay);
            const w10 = ax * (1 - ay);
            const w01 = (1 - ax) * ay;
            const w11 = ax * ay;
            const r = Math.round(d[i00]! * w00 + d[i10]! * w10 + d[i01]! * w01 + d[i11]! * w11);
            const g = Math.round(d[i00 + 1]! * w00 + d[i10 + 1]! * w10 + d[i01 + 1]! * w01 + d[i11 + 1]! * w11);
            const b = Math.round(d[i00 + 2]! * w00 + d[i10 + 2]! * w10 + d[i01 + 2]! * w01 + d[i11 + 2]! * w11);
            const wt = wx[Math.round(px)]! * wy[Math.round(py)]!;
            const cls = lut[lutIndex(r, g, b)]!;
            const p = (gy * S + sy) * pw + gx * S + sx;
            this.pWeight[p]! += wt;
            if (cls === SEA) this.pSea[p]! += wt;
            else if (cls === GRASS) this.pGrass[p]! += wt;
            const inner = INNER[sx]! * INNER[sy]!;
            if (inner === 0) {
              this.pLight[p]! += wt * lightness(r, g, b);
              continue;
            }
            toLab(r, g, b, lab);
            const l = lab[0]!;
            this.pLight[p]! += wt * l;
            const iw = wt * inner;
            this.iWeight[cell]! += iw;
            this.iL[cell]! += iw * l;
            this.iA[cell]! += iw * lab[1]!;
            this.iB[cell]! += iw * lab[2]!;
            if (sx !== CENTRE || sy !== CENTRE) continue;
            this.cWeight[cell]! += wt;
            this.cL[cell]! += wt * l;
            this.cA[cell]! += wt * lab[1]!;
            this.cB[cell]! += wt * lab[2]!;
            this.cSat[cell]! += wt * saturation(r, g, b);
            if (wt > E.trust) {
              this.tCount[cell]! += 1;
              this.tSum[cell]! += l;
              this.tSq[cell]! += l * l;
            }
          }
        }
      }
    }
  }

  /** Folds in a still run's reduced deviation at its distinct frame's solved position, weighted by
   *  the run's frame count and the lattice's tile position weight. */
  addDeviation(dev: ReducedDeviation, at: FramePosition, frames: number): void {
    if (this.finished) throw new Error('the evidence is finished');
    const LW = SCAN_PROFILE.lattice.weight;
    const { width: W, height: H } = this;
    const { cellX0, cellY0, cols } = this.grid;
    const range = this.cellRange(at);
    const half = (dev.step - 1) / 2;
    for (let gy = range.y0; gy < range.y1; gy++) {
      for (let gx = range.x0; gx < range.x1; gx++) {
        const t = this.lattice.cellToTile(cellX0 + gx + 0.5, cellY0 + gy + 0.5, at);
        if (!(t.x >= 0 && t.y >= 0 && t.x <= W - 1 && t.y <= H - 1)) continue;
        const rx = (t.x - half) / dev.step;
        const ry = (t.y - half) / dev.step;
        if (!(rx >= 0 && ry >= 0 && rx <= dev.width - 1 && ry <= dev.height - 1)) continue;
        const ix = Math.min(dev.width - 2, Math.floor(rx));
        const iy = Math.min(dev.height - 2, Math.floor(ry));
        const ax = rx - ix;
        const ay = ry - iy;
        const i = iy * dev.width + ix;
        const v = dev.data;
        const top = v[i]! + (v[i + 1]! - v[i]!) * ax;
        const bottom = v[i + dev.width]! + (v[i + dev.width + 1]! - v[i + dev.width]!) * ax;
        const value = (top + (bottom - top) * ay) / dev.scale;
        const wt = frames * Math.exp(-(((t.x - LW.centreX * W) / (LW.sigma * W)) ** 2 + ((t.y - LW.centreY * H) / (LW.sigma * H)) ** 2));
        const cell = gy * cols + gx;
        this.aSum[cell]! += wt * value;
        this.aWeight[cell]! += wt;
      }
    }
  }

  /**
   * The ground so far for the import's preview: units of one cell (more when the grid is wide), each
   * classed by its cells' centre points' votes: sea or grass above `SCAN_PROFILE.ground.vote` of the weight, sand
   * otherwise, unseen without weight. Reads the centre points only, so it costs a pass over the
   * cells.
   */
  preview(): ScanPreview {
    const { cellX0, cellY0, cols, rows } = this.grid;
    const f = previewMerge(cols, rows);
    const ucols = Math.ceil(cols / f);
    const urows = Math.ceil(rows / f);
    const out = new PreviewGrid(ucols, urows);
    const { pw, pWeight, pSea, pGrass } = this;
    for (let ur = 0; ur < urows; ur++) {
      for (let uc = 0; uc < ucols; uc++) {
        let w = 0, sea = 0, grass = 0;
        for (let gy = ur * f; gy < Math.min(rows, (ur + 1) * f); gy++) {
          for (let gx = uc * f; gx < Math.min(cols, (uc + 1) * f); gx++) {
            const p = (gy * S + CENTRE) * pw + gx * S + CENTRE;
            w += pWeight[p]!;
            sea += pSea[p]!;
            grass += pGrass[p]!;
          }
        }
        if (!(w > 0)) continue;
        out.set(uc, ur, sea > G.vote * w ? PREVIEW_SEA : grass > G.vote * w ? PREVIEW_GRASS : PREVIEW_SAND);
      }
    }
    const origin = this.lattice.cellToTile(cellX0, cellY0, { x: 0, y: 0 });
    const step = this.lattice.cellToTile(cellX0 + f, cellY0 + f, { x: 0, y: 0 });
    return {
      kind: 'ground', x: origin.x, y: origin.y, unitW: step.x - origin.x, unitH: step.y - origin.y,
      cols: ucols, rows: urows, classes: out.classes, chunk: this.lattice.cells / f,
    };
  }

  /** Turns the sums into means in place; the accumulator takes no more frames. */
  finish(): CellEvidence {
    if (this.finished) throw new Error('the evidence is finished');
    this.finished = true;
    const { pWeight, pSea, pGrass, pLight } = this;
    for (let i = 0; i < pWeight.length; i++) {
      const w = pWeight[i]!;
      if (w > 0) {
        pSea[i] = pSea[i]! / w;
        pGrass[i] = pGrass[i]! / w;
        pLight[i] = pLight[i]! / w;
      } else {
        pSea[i] = 1;
        pGrass[i] = 0;
        pLight[i] = 0;
      }
    }
    const cells = this.cWeight.length;
    const deviation = new Float32Array(cells);
    for (let c = 0; c < cells; c++) {
      const w = this.cWeight[c]!;
      if (w > 0) {
        this.cL[c] = this.cL[c]! / w;
        this.cA[c] = this.cA[c]! / w;
        this.cB[c] = this.cB[c]! / w;
        this.cSat[c] = this.cSat[c]! / w;
      }
      const iw = this.iWeight[c]!;
      if (iw > 0) {
        this.iL[c] = this.iL[c]! / iw;
        this.iA[c] = this.iA[c]! / iw;
        this.iB[c] = this.iB[c]! / iw;
      }
      const n = Math.max(this.tCount[c]!, 1);
      const m = this.tSum[c]! / n;
      deviation[c] = Math.sqrt(Math.max(0, this.tSq[c]! / n - m * m));
      this.aSum[c] = this.aSum[c]! / Math.max(this.aWeight[c]!, 1e-3);
    }
    return {
      grid: this.grid,
      sub: S,
      points: { width: this.pw, height: this.ph, weight: pWeight, sea: pSea, grass: pGrass, lightness: pLight },
      weight: this.cWeight,
      lab: { l: this.cL, a: this.cA, b: this.cB },
      saturation: this.cSat,
      lightnessDeviation: deviation,
      animation: this.aSum,
      inner: { weight: this.iWeight, l: this.iL, a: this.iA, b: this.iB },
    };
  }
}
