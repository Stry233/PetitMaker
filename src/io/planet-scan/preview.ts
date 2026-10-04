import { inSeaBand, labHue, toLab, GRASS, SAND, SEA, type PaletteSampler } from './colour';
import { SCAN_PROFILE } from './profile';

// What the import window draws while a scan runs: a coarse grid of the ground read so far, small
// enough to post every few hundred milliseconds. Pass 1 sends the palette mosaic's coverage on the
// tracked chain path, each unit classed by its mean colour's hue against fixed bands, with the
// camera's view; pass 2 sends the lattice's cells as the ground evidence classes them so far. Both
// place the grid on the ground in rectified path pixels, so the two passes line up to within the
// chain path's drift.

/** A preview unit's class, two bits: not seen yet, or the ground the scan reads there. */
export const PREVIEW_UNSEEN = 0;
export const PREVIEW_SEA = 1 + SEA;
export const PREVIEW_SAND = 1 + SAND;
export const PREVIEW_GRASS = 1 + GRASS;
export type PreviewClass = typeof PREVIEW_UNSEEN | typeof PREVIEW_SEA | typeof PREVIEW_SAND | typeof PREVIEW_GRASS;

/** A preview grid has at most this many units a side; larger grids merge units. */
export const PREVIEW_MAX_UNITS = 192;

/** The least time between two previews, in ms. */
export const PREVIEW_MS = 250;

export interface ScanPreview {
  /** `coverage` in pass 1, `ground` in pass 2. */
  readonly kind: 'coverage' | 'ground';
  /** The grid's top-left corner on the ground, in rectified path pixels. */
  readonly x: number;
  readonly y: number;
  /** One unit's size on the ground, in rectified path pixels. */
  readonly unitW: number;
  readonly unitH: number;
  readonly cols: number;
  readonly rows: number;
  /** `cols * rows` classes, row-major, four to a byte, the first in the low bits. */
  readonly classes: Uint8Array;
  /** Pass 1: each unit's mean colour in the recording, `cols * rows` R, G, B triples, row-major;
   *  a unit not seen yet is black. */
  readonly rgb?: Uint8Array;
  /** Pass 1: the camera's view of the ground, in rectified path pixels. */
  readonly view?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Pass 2: units per chunk side, with chunk lines on the grid's edges. */
  readonly chunk?: number;
}

/** A grid of preview classes being filled. */
export class PreviewGrid {
  readonly classes: Uint8Array;
  constructor(readonly cols: number, readonly rows: number) {
    this.classes = new Uint8Array(Math.ceil((cols * rows) / 4));
  }

  set(col: number, row: number, value: PreviewClass): void {
    const i = row * this.cols + col;
    const shift = (i & 3) * 2;
    this.classes[i >> 2] = (this.classes[i >> 2]! & ~(3 << shift)) | (value << shift);
  }
}

/** The class of unit `index` of a preview. */
export function previewClass(preview: Pick<ScanPreview, 'classes'>, index: number): PreviewClass {
  return ((preview.classes[index >> 2]! >> ((index & 3) * 2)) & 3) as PreviewClass;
}

/** How many source units merge into one preview unit for a source grid of `cols` x `rows`. */
export function previewMerge(cols: number, rows: number): number {
  return Math.max(1, Math.ceil(Math.max(cols, rows) / PREVIEW_MAX_UNITS));
}

/** Lets a preview through at most every `PREVIEW_MS`. */
export class PreviewClock {
  private last = -Infinity;
  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Whether a preview is due now; a due preview starts the next wait. */
  due(): boolean {
    const t = this.now();
    if (t - this.last < PREVIEW_MS) return false;
    this.last = t;
    return true;
  }
}

/** Palette bins per coverage unit on each axis, before any merge for a large mosaic: about a cell. */
const COVERAGE_BINS = 2;

/**
 * Pass 1's preview: the palette mosaic merged into units of `COVERAGE_BINS` bins (more when the
 * mosaic is wide), on the bin grid's own multiples so units stay put as the mosaic grows. A unit is
 * seen once its weight passes the sampler's `minWeight`; it carries its mean colour, classed by hue: sea
 * in the sea band, sand below `SCAN_PROFILE.ground.previewSplit`, grass above.
 */
export function coveragePreview(sampler: PaletteSampler, view: { x: number; y: number; w: number; h: number }): ScanPreview | null {
  const m = sampler.mosaic;
  // The mosaic grows with margins; the preview covers the bins tiles reached.
  const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = m.seen;
  if (!(bx1 > bx0 && by1 > by0)) return null;
  const k = COVERAGE_BINS * previewMerge(Math.ceil((bx1 - bx0) / COVERAGE_BINS) + 1, Math.ceil((by1 - by0) / COVERAGE_BINS) + 1);
  const ux0 = Math.floor(bx0 / k);
  const uy0 = Math.floor(by0 / k);
  const cols = Math.ceil(bx1 / k) - ux0;
  const rows = Math.ceil(by1 / k) - uy0;
  const sums = new Float64Array(cols * rows * 4);
  for (let r = by0 - m.y0; r < by1 - m.y0; r++) {
    const ur = Math.floor((m.y0 + r) / k) - uy0;
    for (let c = bx0 - m.x0; c < bx1 - m.x0; c++) {
      const i = (r * m.cols + c) * 4;
      if (!(m.sums[i + 3]! > 0)) continue;
      const o = (ur * cols + Math.floor((m.x0 + c) / k) - ux0) * 4;
      sums[o]! += m.sums[i]!;
      sums[o + 1]! += m.sums[i + 1]!;
      sums[o + 2]! += m.sums[i + 2]!;
      sums[o + 3]! += m.sums[i + 3]!;
    }
  }
  const grid = new PreviewGrid(cols, rows);
  const rgb = new Uint8Array(cols * rows * 3);
  const lab = new Float64Array(3);
  const split = SCAN_PROFILE.ground.previewSplit;
  for (let u = 0; u < cols * rows; u++) {
    const w = sums[u * 4 + 3]!;
    if (!(w > sampler.minWeight)) continue;
    const c = (v: number) => Math.min(255, Math.max(0, Math.round(v / w)));
    const r = c(sums[u * 4]!), g = c(sums[u * 4 + 1]!), b = c(sums[u * 4 + 2]!);
    rgb[u * 3] = r;
    rgb[u * 3 + 1] = g;
    rgb[u * 3 + 2] = b;
    toLab(r, g, b, lab);
    const h = labHue(lab[1]!, lab[2]!);
    grid.set(u % cols, Math.floor(u / cols), inSeaBand(h) ? PREVIEW_SEA : h < split ? PREVIEW_SAND : PREVIEW_GRASS);
  }
  const unit = k * m.step;
  return { kind: 'coverage', x: ux0 * unit, y: uy0 * unit, unitW: unit, unitH: unit, cols, rows, classes: grid.classes, rgb, view };
}
