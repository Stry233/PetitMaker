/*
 * How a built letter is judged, and the pipeline that builds one. A stencilled letter keeps one piece
 * of ink per piece of the glyph (a corner touch is two blocks on the map), open counters, one stroke
 * width, and an outline free of one-cell bumps and notches.
 *
 * The app never scores a stencil, so the measures live beside the tests; the evaluation harness drives
 * the same code, so a test threshold and a harness column mean the same thing.
 */
import { createDefaultRegistry } from '../../../../rules';
import { createGrid } from '../../../../core/model/grid-model';
import { finishGlyph } from '../../../../tools/generation/stencil/stencil-stroke';
import { glyphExtent, strokeShare } from '../../../../tools/generation/stencil/stencil-stem';
import { bridgesDaylight, COVERAGE_ON, densityOf, GLYPH_LEGIBLE, separationOf, textMinBox, TOUCHED_INK } from '../../../../tools/generation/stencil/stencil';
import { TerrainType, type Corners, type GridState, type MapTemplate } from '../../../../core/model/types';
import { copyCorners } from '../../../../core/model/corners';
import { defaultConfig, type GenerateConfig, type Stencil } from '../../../../tools/generation/recipe';
import { CellZone } from '../../../../core/game/zones';
import { createExecutor } from '../../../../state/executor';
import { generateWith } from '../../../_support/generation';

/** The stem width in cells the weight choice aims a glyph at: its stroke share of the extent, at
 *  least one cell, and 0 for a picture. */
export function strokeTarget(text: string, box: { width: number; height: number }): number {
  const share = strokeShare(text, box);
  if (share === 0) return 0;
  return Math.max(1, Math.round(glyphExtent(text, box) * share));
}

/** A binary picture, the form every measure below reads. */
export interface Mask { width: number; height: number; on: Uint8Array }

export function maskOf(width: number, height: number, test: (i: number) => boolean): Mask {
  const on = new Uint8Array(width * height);
  for (let i = 0; i < on.length; i++) on[i] = test(i) ? 1 : 0;
  return { width, height, on };
}

const EDGES: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGS: readonly [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function at(m: Mask, x: number, y: number): number {
  return x < 0 || y < 0 || x >= m.width || y >= m.height ? 0 : m.on[y * m.width + x]!;
}

/** Connected components of the ink. Two cells meeting only at a corner are separate blocks on the
 *  map, so a letter is whole only under 4-connectivity; the gap between the 4- and 8-counts is the
 *  "strokes disconnect" defect. */
export function components(m: Mask, connectivity: 4 | 8 = 4): number {
  const seen = new Uint8Array(m.on.length);
  const steps = connectivity === 4 ? EDGES : [...EDGES, ...DIAGS];
  let count = 0;
  for (let i = 0; i < m.on.length; i++) {
    if (!m.on[i] || seen[i]) continue;
    count++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % m.width, y = (j / m.width) | 0;
      for (const [dx, dy] of steps) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
        const n = ny * m.width + nx;
        if (m.on[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
  }
  return count;
}

/** Enclosed background regions: a letter's counters. The background walks orthogonally too, as on
 *  the map, where nothing passes through a diagonal touch. */
export function holes(m: Mask): number {
  const seen = new Uint8Array(m.on.length);
  const steps = EDGES;
  let count = 0;
  for (let i = 0; i < m.on.length; i++) {
    if (m.on[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let open = false;
    const region: number[] = [];
    while (stack.length) {
      const j = stack.pop()!;
      region.push(j);
      const x = j % m.width, y = (j / m.width) | 0;
      if (x === 0 || y === 0 || x === m.width - 1 || y === m.height - 1) open = true;
      for (const [dx, dy] of steps) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
        const n = ny * m.width + nx;
        if (!m.on[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    if (!open) count++;
  }
  return count;
}

/** Chessboard distance from each ink cell to the nearest cell outside the ink, the stencil's own
 *  outside included: 1 on the outline, the local half-width in the middle of a stroke. */
export function insideDistance(m: Mask): Uint16Array {
  const dist = new Uint16Array(m.on.length);
  const queue: number[] = [];
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const i = y * m.width + x;
      if (!m.on[i]) continue;
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!at(m, x + dx, y + dy)) { edge = true; break; }
        }
      }
      if (edge) { dist[i] = 1; queue.push(i); }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % m.width, y = (i / m.width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
        const n = ny * m.width + nx;
        if (!m.on[n] || dist[n] !== 0) continue;
        dist[n] = dist[i]! + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

/** How wide the strokes run: at each ink cell, the shorter of its row run and column run, which
 *  over-estimates only where two strokes cross. Runs, not the distance transform, because a chessboard
 *  distance cannot tell a two-cell stroke from a one-cell one. */
export function strokeWidths(m: Mask): { median: number; spread: number; max: number; samples: number } {
  const widths: number[] = [];
  const run = (x: number, y: number, dx: number, dy: number): number => {
    let n = 1;
    for (let k = 1; at(m, x + dx * k, y + dy * k); k++) n++;
    for (let k = 1; at(m, x - dx * k, y - dy * k); k++) n++;
    return n;
  };
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (!m.on[y * m.width + x]) continue;
      widths.push(Math.min(run(x, y, 1, 0), run(x, y, 0, 1)));
    }
  }
  if (!widths.length) return { median: 0, spread: 0, max: 0, samples: 0 };
  // Median and quartile spread, because a few junction cells would drag a mean far past any drawn width.
  widths.sort((a, b) => a - b);
  const quantile = (q: number): number => widths[Math.min(widths.length - 1, Math.floor(widths.length * q))]!;
  return { median: quantile(0.5), spread: quantile(0.75) - quantile(0.25), max: widths[widths.length - 1]!, samples: widths.length };
}

/** Flood-fill oracle for background that would be trapped by filling one cell. */
function sealsGround(s: Stencil, x: number, y: number): boolean {
  const { width: w, height: h, coverage } = s;
  const blocked = y * w + x;
  for (const [dx, dy] of EDGES) {
    const sx = x + dx, sy = y + dy;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;      // this side is the outside already
    const start = sy * w + sx;
    if (coverage[start]! >= COVERAGE_ON) continue;
    const seen = new Uint8Array(w * h);
    seen[blocked] = 1;
    seen[start] = 1;
    const stack = [start];
    let escapes = false;
    while (stack.length && !escapes) {
      const i = stack.pop()!;
      const cx = i % w, cy = (i / w) | 0;
      for (const [ex, ey] of EDGES) {
        const nx = cx + ex, ny = cy + ey;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { escapes = true; break; }
        const n = ny * w + nx;
        if (coverage[n]! >= COVERAGE_ON || seen[n]) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (!escapes) return true;
  }
  return false;
}

/**
 * The outline's damage. A nub is one ink cell hanging off a body at least two cells wide; a notch is an
 * empty cell bitten out of ink that surrounds it on three sides. Both survive the corner trim as a
 * bevelled step in the middle of a line.
 */
export function raggedness(m: Mask, touched?: Mask): { nubs: number; notches: number; isolated: number } {
  // A notch counts only where glyph finishing could have filled it: a one-cell gap between strokes is
  // the character's daylight, and a cell the face never inked is ground.
  const asStencil = { width: m.width, height: m.height, coverage: m.on.map((v) => (v ? 255 : 0)), color: new Uint32Array(m.on.length) };
  let nubs = 0, notches = 0, isolated = 0;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const i = y * m.width + x;
      let ink = 0;
      for (const [dx, dy] of EDGES) ink += at(m, x + dx, y + dy);
      if (m.on[i]) {
        if (ink === 0) isolated++;
        // A wire stroke's tip is drawing, not a bump; this reads bumps as
        // `stencil-stroke.ts:smoothOutline` does.
        if (ink === 1) {
          for (const [dx, dy] of EDGES) {
            const nx = x + dx, ny = y + dy;
            if (!at(m, nx, ny)) continue;
            const body = at(m, nx, ny - 1) + at(m, nx + 1, ny) + at(m, nx, ny + 1) + at(m, nx - 1, ny);
            if (body >= 3) nubs++;
            break;
          }
        }
      } else if (ink >= 3 && (!touched || at(touched, x, y) === 1)
        && !bridgesDaylight(asStencil, x, y) && !sealsGround(asStencil, x, y)) notches++;
    }
  }
  return { nubs, notches, isolated };
}

/** Where a shape's edge runs: per scanline, the first ink cell along the scan, or -1 where none. */
export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

export function edgeProfile(m: Mask, side: EdgeSide): number[] {
  const vertical = side === 'left' || side === 'right';
  const lanes = vertical ? m.height : m.width;
  const along = vertical ? m.width : m.height;
  const back = side === 'right' || side === 'bottom';
  const out: number[] = [];
  for (let lane = 0; lane < lanes; lane++) {
    let found = -1;
    for (let k = 0; k < along; k++) {
      const i = back ? along - 1 - k : k;
      const [x, y] = vertical ? [i, lane] : [lane, i];
      if (m.on[y * m.width + x]) { found = i; break; }
    }
    out.push(found);
  }
  return out;
}

/** The shortest straight edge worth judging; below it a letter's curvature looks like a wobble. */
const STRAIGHT_RUN = 5;

/**
 * Whether what was straight came out straight. The reference names its straight runs (edges moving by
 * the same 0 or ±1 each step), and over each the built edge is fitted to its own least-squares line, so
 * a letter one cell over is not crooked. A break is a scanline inside a run with no built edge.
 */
export interface Straightness { runs: number; deviation: number; breaks: number }

export function straightness(built: Mask, reference: Mask): Straightness {
  let runs = 0, deviation = 0, breaks = 0;
  for (const side of ['left', 'right', 'top', 'bottom'] as EdgeSide[]) {
    const ref = edgeProfile(reference, side), got = edgeProfile(built, side);
    let i = 0;
    while (i < ref.length) {
      if (ref[i]! < 0) { i++; continue; }
      // The longest straight run starting here, at any of the three slopes.
      let bestEnd = i;
      for (const slope of [0, 1, -1]) {
        let end = i;
        while (end + 1 < ref.length && ref[end + 1]! >= 0 && ref[end + 1]! - ref[end]! === slope) end++;
        if (end > bestEnd) bestEnd = end;
      }
      if (bestEnd - i + 1 < STRAIGHT_RUN) { i++; continue; }
      runs++;
      // Breaks are interior: a run the built letter falls short of is a slightly smaller letter.
      let first = -1, last = -1;
      for (let k = i; k <= bestEnd; k++) if (got[k]! >= 0) { if (first < 0) first = k; last = k; }
      for (let k = first; k >= 0 && k <= last; k++) if (got[k]! < 0) breaks++;
      // Fit only pieces that could be one line: a step of two cells or more is another feature (a bar
      // beside the stem). Each end scanline is dropped, since a face rounds junctions and terminals.
      first += 1; last -= 1;
      while (first >= 0 && first <= last && got[first]! < 0) first++;
      for (let k = first; k >= 0 && k <= last;) {
        let end = k;
        while (end + 1 <= last && got[end + 1]! >= 0 && Math.abs(got[end + 1]! - got[end]!) <= 1) end++;
        if (end - k + 1 >= STRAIGHT_RUN) {
          const d = lineDeviation(got.slice(k, end + 1));
          if (d > deviation) deviation = d;
        }
        k = end + 1;
        while (k <= last && got[k]! < 0) k++;
      }
      i = bestEnd + 1;
    }
  }
  return { runs, deviation, breaks };
}

/** How far the worst of these values sits from the least-squares line through them all. */
export function lineDeviation(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (let k = 0; k < n; k++) { mx += k; my += values[k]!; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (k - mx) * (values[k]! - my); sxx += (k - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  let worst = 0;
  for (let k = 0; k < n; k++) {
    const d = Math.abs(values[k]! - (my + slope * (k - mx)));
    if (d > worst) worst = d;
  }
  return worst;
}

/** The same mask moved by (dx, dy) cells, dropping whatever leaves the picture. */
export function shifted(m: Mask, dx: number, dy: number): Mask {
  const out = maskOf(m.width, m.height, () => false);
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (!m.on[y * m.width + x]) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
      out.on[ny * m.width + nx] = 1;
    }
  }
  return out;
}

/**
 * The reference moved by up to a cell either way to overlap the built letter best. The stencil's
 * sub-cell phase and the 4x reference can settle a cell apart, which would halve the overlap of a
 * perfect one-cell stem.
 */
export function registered(built: Mask, reference: Mask): Mask {
  const [dx, dy] = bestShift(built, reference);
  return dx || dy ? shifted(reference, dx, dy) : reference;
}

/** The move, of up to a cell either way, that lands the reference best on the built letter. */
export function bestShift(built: Mask, reference: Mask): [number, number] {
  let best: [number, number] = [0, 0], bestScore = -1;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const score = iou(built, dx || dy ? shifted(reference, dx, dy) : reference);
      if (score > bestScore) { bestScore = score; best = [dx, dy]; }
    }
  }
  return best;
}

/** A mask as the stencil the engine's own readings take. */
const asStencil = (m: Mask): Stencil => ({
  width: m.width, height: m.height,
  coverage: Uint8Array.from(m.on, (v) => (v ? 255 : 0)),
  color: new Uint32Array(m.on.length),
});

/**
 * How much of the drawing's stroke separation the built letter keeps, and how much of its box is ink.
 * Both are the engine's own readings (`tools/generation/stencil/stencil.ts`), which the shelf refuses a
 * card on; only the adaptation from a Mask lives here.
 */
export function separation(
  built: Mask, runsRow: readonly number[], runsCol: readonly number[], shift: [number, number] = [0, 0],
): number {
  return separationOf(asStencil(built), runsRow, runsCol, shift);
}

export function density(m: Mask): number {
  return densityOf(asStencil(m));
}

export function iou(a: Mask, b: Mask): number {
  let inter = 0, union = 0;
  for (let i = 0; i < a.on.length; i++) {
    const p = a.on[i]!, q = b.on[i]!;
    if (p && q) inter++;
    if (p || q) union++;
  }
  return union ? inter / union : 1;
}

/** How much of the reference's skeleton the built letter carries, within a cell; a vanished stroke
 *  shows here where an IoU sees only a lighter letter. */
export function skeletonRecall(final: Mask, reference: Mask): number {
  const dist = insideDistance(reference);
  let want = 0, got = 0;
  for (let y = 0; y < reference.height; y++) {
    for (let x = 0; x < reference.width; x++) {
      const i = y * reference.width + x;
      const d = dist[i]!;
      if (!d) continue;
      let ridge = true;
      for (let dy = -1; dy <= 1 && ridge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= reference.width || ny >= reference.height) continue;
          if (dist[ny * reference.width + nx]! > d) { ridge = false; break; }
        }
      }
      if (!ridge) continue;
      want++;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (at(final, x + dx, y + dy)) { near = true; break; }
      }
      if (near) got++;
    }
  }
  return want ? got / want : 1;
}

// The pipeline a score is taken from

/** A stored font raster: what the face drew, before any of the processing. */
export interface RasterFixture {
  text: string;
  /** The region, in cells, the glyph was fitted to: one square per code point. */
  width: number;
  height: number;
  /** The CSS weight the derivation asked the face for. */
  weight: number;
  /** Cell coverage, one byte each, row-major. */
  coverage: Uint8Array;
  /** Per-cell quadrant coverage [TL, TR, BL, BR]: the trim pass's own signal. */
  quad: Uint8Array;
  /** The same glyph at the same weight, drawn larger and reduced: what the built letter is compared
   *  against. */
  reference: Uint8Array;
  /** The same letter drawn without the placement search, at the region's own resolution. */
  centred: Uint8Array;
  /** The same, drawn larger and reduced: a reference the search did not place. */
  fixedReference: Uint8Array;
  /** How many separate pieces of the drawing each row and column crosses, at the reference's full
   *  resolution; a weight that fuses two strokes fuses them in the reference too. */
  runsRow: number[];
  runsCol: number[];
  /** The glyph's pieces and counters at the reference's full resolution, since a light stroke at ten
   *  cells averages below half a cell and the reduction would arrive broken. */
  pieces: number;
  counters: number;
}

/** The committed rasters as stored, byte arrays in base64. */
export interface RasterFixtureFile {
  /** The font stack the rasters were drawn with. */
  font: string;
  generated: string;
  /** How many times the region's own resolution the reference was drawn at before being reduced. */
  referenceScale: number;
  entries: {
    text: string; width: number; height: number; weight: number;
    /** Coverage bytes, base64. */
    coverage: string; quad: string; centred: string;
    /** Masks, one bit per cell, base64. */
    reference: string; fixedReference: string;
    pieces: number; counters: number; runsRow: number[]; runsCol: number[];
  }[];
}

const bytes = (b64: string): Uint8Array => {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

/** A mask stored one bit per cell, back as a byte each. */
const unpack = (b64: string, cells: number): Uint8Array => {
  const raw = bytes(b64);
  const out = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) out[i] = (raw[i >> 3]! >> (i & 7)) & 1;
  return out;
};

export function decodeFixture(file: RasterFixtureFile): RasterFixture[] {
  return file.entries.map((e) => ({
    text: e.text, width: e.width, height: e.height, weight: e.weight,
    coverage: bytes(e.coverage), quad: bytes(e.quad), centred: bytes(e.centred),
    reference: unpack(e.reference, e.width * e.height),
    fixedReference: unpack(e.fixedReference, e.width * e.height),
    runsRow: e.runsRow, runsCol: e.runsCol,
    pieces: e.pieces, counters: e.counters,
  }));
}

export function stencilOf(fixture: RasterFixture): Stencil {
  const n = fixture.width * fixture.height;
  return {
    width: fixture.width,
    height: fixture.height,
    coverage: Uint8Array.from(fixture.coverage),
    color: new Uint32Array(n),
    quad: Uint8Array.from(fixture.quad),
  };
}

/** The face's own picture at this resolution, before processing: the most the region can hold, which
 *  is what topology is judged against. */
export function rawMask(fixture: RasterFixture): Mask {
  return maskOf(fixture.width, fixture.height, (i) => fixture.coverage[i]! >= COVERAGE_ON);
}

export function referenceMask(fixture: RasterFixture): Mask {
  return maskOf(fixture.width, fixture.height, (i) => fixture.reference[i]! > 0);
}

/**
 * Each placement's fidelity as 1 minus its area error against the ink the face drew (summed
 * `coverage`), a measure no placement enters, unlike an IoU against a placed reference.
 */
export function placementGain(fixture: RasterFixture): { fitted: number; centred: number } {
  const finish = (coverage: Uint8Array): number => {
    const s: Stencil = {
      width: fixture.width, height: fixture.height,
      coverage: Uint8Array.from(coverage), color: new Uint32Array(coverage.length),
      quad: Uint8Array.from(fixture.quad),
    };
    finishGlyph(s);
    let cells = 0;
    for (let i = 0; i < s.coverage.length; i++) if (s.coverage[i]! >= COVERAGE_ON) cells++;
    return cells;
  };
  const area = (c: Uint8Array): number => c.reduce((total: number, v) => total + v, 0) / 255;
  // Averaged, since a glyph shifted to its box's edge can lose a sliver of ink to the border.
  const drawn = Math.max(1e-6, (area(fixture.coverage) + area(fixture.centred)) / 2);
  const fidelity = (built: number): number => 1 - Math.abs(built - drawn) / drawn;
  return { fitted: fidelity(finish(fixture.coverage)), centred: fidelity(finish(fixture.centred)) };
}

/** A blank buildable map with a margin around the stencil. */
function freshMap(width: number, height: number): GridState {
  const zones: CellZone[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => CellZone.Grass));
  const template: MapTemplate = {
    id: 'stencil-eval', name: { en: 'Stencil eval', zh: '模板评估' },
    width, height, zones,
    landmarks: [],
  };
  return { template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

export const STENCIL_MARGIN = 3;

export interface BuiltGlyph {
  state: GridState;
  origin: { x: number; y: number };
  /** The stencil as the generator received it: the raster, repaired and capped. */
  stencil: Stencil;
  /** The real blocks the run left, in stencil coordinates; a Γ fillet is cosmetic and not ink. */
  ink: Mask;
  /** Cosmetic fillets the trim pass added, same coordinates. */
  patches: Mask;
  corners: (Corners | null)[];
  violations: number;
}

/** A stored raster taken to committed terrain through the shelf's pipeline, corner trim included. */
export function buildGlyph(fixture: RasterFixture): BuiltGlyph {
  const stencil = stencilOf(fixture);
  finishGlyph(stencil);
  const state = freshMap(fixture.width + STENCIL_MARGIN * 2, fixture.height + STENCIL_MARGIN * 2);
  const origin = { x: STENCIL_MARGIN, y: STENCIL_MARGIN };
  const exec = createExecutor(state, createDefaultRegistry());
  const whole = exec.beginStroke();
  const config: GenerateConfig = defaultConfig('stencil', { maxElevation: 8, seed: 1, stencilPlan: { read: 'shape', fill: { kind: 'terrain', terrain: TerrainType.Mountain }, stencil, origin } });
  exec.transaction({ silent: true }, () => { generateWith(state, exec, config); });
  const violations = whole.commit().length;

  const { width: fw, height: fh } = fixture;
  const corners: (Corners | null)[] = [];
  const ink = maskOf(fw, fh, () => false);
  const patches = maskOf(fw, fh, () => false);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const t = state.cells[origin.y + y]?.[origin.x + x]?.terrain;
      const i = y * fw + x;
      corners.push(t?.corners ? copyCorners(t.corners) : null);
      if (!t || t.type === TerrainType.None) continue;
      if (t.patchOnly) patches.on[i] = 1; else ink.on[i] = 1;
    }
  }
  return { state, origin, stencil, ink, patches, corners, violations };
}

export interface GlyphScore {
  text: string;
  size: number;
  box: string;
  weight: number;
  cells: number;
  /** Pieces the built letter is in, and pieces the reference says it should be in. */
  pieces: number;
  piecesWanted: number;
  /** Pieces that would be whole if a corner touch counted: the ink that fell apart into blocks. */
  cornerOnly: number;
  counters: number;
  /** The counters the face's raster holds at this size, which processing answers for, and the
   *  counters the letter really has. */
  countersHeld: number;
  countersWanted: number;
  width: { median: number; spread: number; max: number };
  /** The stroke width the cap aimed at. */
  target: number;
  nubs: number;
  notches: number;
  isolated: number;
  /** Cells standing alone in the face's own raster; only what processing adds is a defect. */
  isolatedHeld: number;
  iou: number;
  recall: number;
  straight: Straightness;
  /** The share of the drawing's stroke separation that survived. */
  separation: number;
  /** The runs the drawing crosses, to tell a one-stroke letter apart. */
  runsWanted: number[];
  /** The share of the letter's box that is ink. */
  density: number;
  /** Whether the region is under the text's floor (`stencil.ts:textMinBox`); such cells are reported,
   *  not failed. */
  underFloor: boolean;
  violations: number;
  patches: number;
}

export function scoreGlyph(fixture: RasterFixture, built: BuiltGlyph): GlyphScore {
  const shift = bestShift(built.ink, referenceMask(fixture));
  const ref = registered(built.ink, referenceMask(fixture));
  const raw = rawMask(fixture);
  const four = components(built.ink, 4);
  const eight = components(built.ink, 8);
  // The cells the face inked, by the bar glyph finishing fills a notch under (`stencil.ts:TOUCHED_INK`).
  const touched = maskOf(fixture.width, fixture.height, (i) => fixture.coverage[i]! >= TOUCHED_INK);
  const rag = raggedness(built.ink, touched);
  const w = strokeWidths(built.ink);
  return {
    text: fixture.text,
    size: fixture.height,
    box: `${fixture.width}x${fixture.height}`,
    weight: fixture.weight,
    cells: built.ink.on.reduce((a: number, b) => a + b, 0),
    pieces: four,
    piecesWanted: fixture.pieces,
    cornerOnly: Math.max(0, four - eight),
    counters: holes(built.ink),
    countersHeld: holes(raw),
    countersWanted: fixture.counters,
    width: { median: w.median, spread: w.spread, max: w.max },
    target: strokeTarget(fixture.text, { width: fixture.width, height: fixture.height }),
    nubs: rag.nubs,
    notches: rag.notches,
    isolated: rag.isolated,
    isolatedHeld: raggedness(raw).isolated,
    iou: iou(built.ink, ref),
    recall: skeletonRecall(built.ink, ref),
    straight: straightness(built.ink, ref),
    separation: separation(built.ink, fixture.runsRow, fixture.runsCol, shift),
    runsWanted: [...fixture.runsRow, ...fixture.runsCol],
    density: density(built.ink),
    underFloor: fixture.width < textMinBox(fixture.text).width || fixture.height < textMinBox(fixture.text).height,
    violations: built.violations,
    patches: built.patches.on.reduce((a: number, b) => a + b, 0),
  };
}

/**
 * The thresholds a built letter clears, read off rendered contact sheets. Broken is absolute; ragged is
 * per cell of ink (a nub or notch every fifty cells reads as texture); recall, not IoU, carries the
 * fidelity floor, since a thinner stroke loses IoU by construction.
 */
export const STENCIL_THRESHOLDS = {
  raggedPerCell: 0.02,
  recall: 0.9,
  /** The shelf's own legibility bars (`tools/generation/stencil/stencil.ts:GLYPH_LEGIBLE`). */
  separation: GLYPH_LEGIBLE.separation,
  density: GLYPH_LEGIBLE.density,
  /** How far a built edge may stray from its line, in cells; above 0.5 a cell stepped out and back. */
  straightDeviation: 0.5,
} as const;

export function glyphFailures(s: GlyphScore): string[] {
  // Under the floor the face's own raster cannot hold the strokes, so nothing is failed.
  if (s.underFloor) return [];
  const out: string[] = [];
  if (s.pieces > s.piecesWanted) out.push(`${s.pieces} pieces, wanted ${s.piecesWanted}`);
  // Against the counters the raster held, since one with no cell to be in is the region's resolution.
  if (s.counters !== s.countersHeld) out.push(`${s.counters} counters, the raster held ${s.countersHeld}`);
  if (s.isolated > s.isolatedHeld) out.push(`${s.isolated} cells stand alone, the raster held ${s.isolatedHeld}`);
  const ragged = (s.nubs + s.notches) / Math.max(1, s.cells);
  if (ragged > STENCIL_THRESHOLDS.raggedPerCell) out.push(`outline ${(100 * ragged).toFixed(1)}% ragged (${s.nubs} nubs, ${s.notches} notches)`);
  if (s.recall < STENCIL_THRESHOLDS.recall) out.push(`recall ${s.recall.toFixed(2)}`);
  if (s.straight.deviation > STENCIL_THRESHOLDS.straightDeviation) {
    out.push(`a straight edge wobbles ${s.straight.deviation.toFixed(2)} cells`);
  }
  if (s.straight.breaks) out.push(`${s.straight.breaks} breaks in a straight edge`);
  if (s.separation < STENCIL_THRESHOLDS.separation) {
    out.push(`strokes fused: ${(100 * s.separation).toFixed(0)}% of the drawing's own separation`);
  }
  // A one-stroke letter fills its own box, so density applies only to letters of more strokes.
  if (s.density > STENCIL_THRESHOLDS.density && Math.max(...s.runsWanted) > 1) {
    out.push(`${(100 * s.density).toFixed(0)}% of the letter's box is ink`);
  }
  if (s.violations) out.push(`${s.violations} post-stroke violations`);
  return out;
}
