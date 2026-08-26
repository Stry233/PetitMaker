/*
 * _stencil-metrics.ts — how a built letter is judged, and the pipeline that builds one.
 *
 * WHAT A STENCILLED LETTER HAS TO BE is not a matter of taste, and none of it is visible in a cell
 * count: the ink has to be ONE PIECE per piece of the glyph (a stroke that touches its neighbour only
 * at a corner is two blocks on the map, whatever it looks like in a raster dump), its counters have to
 * stay open, its strokes have to keep one width, and its outline has to be free of the one-cell bumps
 * and notches that read as damage rather than as a curve.
 *
 * The measures live beside the tests rather than in `src/tools`, because the app never scores a
 * stencil — only the project's own evaluation harness and the tests that consume its committed font
 * rasters do. Both drive THIS code, so a threshold in a test and a column in the harness's log cannot
 * mean two different things.
 */
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';
import { createGrid } from '../../../../core/model/grid-model';
import { generateTerrain } from '../../../../tools/generation/terrain-generator';
import { finishGlyph, strokeTarget } from '../../../../tools/generation/stencil/stencil-stroke';
import { bridgesDaylight, COVERAGE_ON, densityOf, GLYPH_LEGIBLE, sealsGround, separationOf, textMinBox, TOUCHED_INK } from '../../../../tools/generation/stencil/stencil';
import { CellZone, TerrainType, type Corners, type EditorEvents, type GenerateConfig, type GridState, type MapTemplate, type Stencil } from '../../../../core/model/types';

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

/** Connected components of the ink, at the connectivity asked for.
 *
 *  FOUR AND EIGHT ARE DIFFERENT QUESTIONS HERE. The map is built out of whole cells, and two cells
 *  meeting at a corner alone are two separate blocks with a gap of ground between them — so a letter
 *  is whole only under 4-connectivity, and the gap between the two counts is exactly the "strokes
 *  disconnect" defect. */
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

/** Enclosed background regions — a letter's counters.
 *
 *  BOTH SIDES WALK ORTHOGONALLY here, which is not the pairing a picture would use and is the one
 *  this map has: terrain connects across edges and so does the ground between it, because a diagonal
 *  touch is a point and nothing passes through a point. Counting the background across diagonals
 *  instead would call two areas one until a repair pass sealed the pinch, and then report a counter
 *  had appeared where nothing on the map had changed. */
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

/** How wide the strokes run: at each ink cell, the shorter of the row run and the column run through
 *  it, which is the stroke's own width wherever it runs with an axis and an over-estimate only where
 *  two strokes cross.
 *
 *  MEASURED IN RUNS, not off the distance transform: a chessboard distance cannot tell a stroke two
 *  cells wide from one cell wide (both sit one step from the outside), so a target of two read back
 *  as one and a cap that was working looked like a cap that had carved the letter to a wire. */
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
  // MEDIAN and the quartile spread, not mean and deviation: where two strokes cross, the run through
  // the crossing is the whole of the other stroke, so a handful of junction cells drag a mean far past
  // any width the letter actually draws.
  widths.sort((a, b) => a - b);
  const quantile = (q: number): number => widths[Math.min(widths.length - 1, Math.floor(widths.length * q))]!;
  return { median: quantile(0.5), spread: quantile(0.75) - quantile(0.25), max: widths[widths.length - 1]!, samples: widths.length };
}

/**
 * The outline's damage, counted as the two shapes an eye reads as damage rather than as drawing.
 *
 * A NUB is an ink cell sticking out of a body on three sides — one cell of a stroke's own width is a
 * stroke, one cell hanging off a stroke that is two or more cells wide is a bump. A NOTCH is its
 * inverse, an empty cell bitten out of a run that surrounds it on three sides. Both are what a
 * one-cell wobble along a straight edge produces, and both survive the corner trim as a bevelled
 * step in the middle of a line.
 */
export function raggedness(m: Mask, touched?: Mask): { nubs: number; notches: number; isolated: number } {
  // A notch is damage only where it COULD HAVE BEEN FILLED, which is the same list of refusals the
  // glyph finishing works from: a one-cell gap between two strokes is the character's own daylight,
  // whether it closes on itself or runs out to the open air, and a cell the face put no ink in at all
  // is ground rather than a bite out of a stroke. Counting either would score the shape for keeping
  // the letter open — and at five cells a letter is nothing but the corners where its one-cell
  // strokes meet, so a measure that read those as damage would refuse every small diagonal.
  const asStencil = { width: m.width, height: m.height, coverage: m.on.map((v) => (v ? 255 : 0)), color: new Uint32Array(m.on.length) };
  let nubs = 0, notches = 0, isolated = 0;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const i = y * m.width + x;
      let ink = 0;
      for (const [dx, dy] of EDGES) ink += at(m, x + dx, y + dy);
      if (m.on[i]) {
        if (ink === 0) isolated++;
        // Only a bump on a body counts: on a wire stroke every cell has two empty sides and its tip
        // has three, which is the drawing rather than damage. Read the same way the pass that carves
        // them reads it (`stencil-stroke.ts:smoothOutline`), or the two disagree about what a bump is.
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

/**
 * WHERE A SHAPE'S EDGE RUNS, one number per scanline: the first ink cell along the scan, or -1 for a
 * scanline the shape does not reach. Four of these describe an outline well enough to ask whether a
 * straight part of it came out straight.
 */
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

/** How long a straight piece of edge has to be before it is worth judging: shorter than this and a
 *  letter's own curvature is indistinguishable from a wobble. */
const STRAIGHT_RUN = 5;

/**
 * WHETHER WHAT WAS STRAIGHT CAME OUT STRAIGHT.
 *
 * A stroke that should be a plain line or a clean 45° must arrive as one — this is the sharpest thing
 * a stencilled letter can get wrong, because a wobble in a line is read as a mistake where a wobble
 * in a curve is read as resolution. So the REFERENCE is asked where its edges are straight (a run of
 * scanlines whose edge moves by the same 0 or ±1 each step, which is exactly a vertical, a horizontal
 * and a 45° diagonal on a grid), and over each of those runs the built letter's own edge is measured
 * against the least-squares line through it.
 *
 * The built edge is fitted to ITSELF rather than compared with the reference's line, because a letter
 * that sits one cell over or is drawn a shade smaller is not crooked; what is being counted is
 * deviation from a straight path, in cells. A BREAK is a scanline inside a straight run where the
 * built letter has no edge at all — the half of a ragged letter an average hides.
 */
export interface Straightness { runs: number; deviation: number; breaks: number }

export function straightness(built: Mask, reference: Mask): Straightness {
  let runs = 0, deviation = 0, breaks = 0;
  for (const side of ['left', 'right', 'top', 'bottom'] as EdgeSide[]) {
    const ref = edgeProfile(reference, side), got = edgeProfile(built, side);
    let i = 0;
    while (i < ref.length) {
      if (ref[i]! < 0) { i++; continue; }
      // The longest straight run starting here: one step decides the slope, and the run holds while
      // every later step repeats it.
      let bestEnd = i;
      for (const slope of [0, 1, -1]) {
        let end = i;
        while (end + 1 < ref.length && ref[end + 1]! >= 0 && ref[end + 1]! - ref[end]! === slope) end++;
        if (end > bestEnd) bestEnd = end;
      }
      if (bestEnd - i + 1 < STRAIGHT_RUN) { i++; continue; }
      runs++;
      // A BREAK IS INTERIOR. A run the built letter simply does not reach the end of is a letter drawn
      // a shade smaller, which is not a hole in a stroke; a scanline with nothing on it BETWEEN two
      // that have something is.
      let first = -1, last = -1;
      for (let k = i; k <= bestEnd; k++) if (got[k]! >= 0) { if (first < 0) first = k; last = k; }
      for (let k = first; k >= 0 && k <= last; k++) if (got[k]! < 0) breaks++;
      // The built edge is measured in pieces that could be one line: a step of two cells or more is a
      // DIFFERENT feature arriving under the same scanline (a bar where the reference had only the
      // stem, one row up or down), not a wobble in this one, and fitting a line across the two would
      // report the whole letter's width as its deviation.
      //
      // The MIDDLE of the run, at that: the scanline where a straight edge begins is the one beside a
      // junction or a terminal, and a face rounds those. The cell of ink that rounding leaves is the
      // drawing, not a wobble in the line that follows it.
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
 * The reference REGISTERED against the built letter: the same picture moved by up to a cell either
 * way, whichever placement overlaps best.
 *
 * A stencil's placement is chosen by which sub-cell phase the grid can hold best, and the reference is
 * drawn at four times the resolution, so the two can settle a cell apart on a letter whose stem is one
 * cell wide. That is a difference of registration and not of shape — uncorrected it halves the
 * measured overlap of a perfectly built letter, which would have every fidelity number reporting the
 * phase of the search instead of the work of the engine.
 */
export function registered(built: Mask, reference: Mask): Mask {
  const [dx, dy] = bestShift(built, reference);
  return dx || dy ? shifted(reference, dx, dy) : reference;
}

/** The move, of up to a cell either way, that lands the reference best on the built letter. Everything
 *  measured against the drawing takes it, or a letter placed a cell over reads as a letter that lost
 *  something. */
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
 * HOW MUCH OF THE DRAWING'S SEPARATE PIECES THE BUILT LETTER STILL CROSSES, and how much of its own
 * box is ink — the two readings that say whether the PATH through a letter is clear.
 *
 * Both are the engine's own (`tools/generation/stencil/stencil.ts`): the shelf refuses a card on exactly
 * these numbers, so a matrix that measured them its own way could call legible what the app refuses,
 * or the reverse. What lives here is only the adaptation from a Mask.
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

/** How much of the reference's own skeleton the built letter still carries, within a cell. The
 *  glyph's structure is its ridge, so a stroke that vanished shows up here where an IoU only sees a
 *  slightly lighter letter. */
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

// --- the pipeline a score is taken from -------------------------------------------------------

/** A stored font raster: what the face drew, before any of the processing. */
export interface RasterFixture {
  text: string;
  /** The region, in cells, the glyph was fitted to: one square per code point, which is the shape a
   *  word is actually written in. A square box for a five-letter word gives each letter a fifth of
   *  the room and judges the engine on a region the shelf's own floor refuses. */
  width: number;
  height: number;
  /** The CSS weight the derivation asked the face for. */
  weight: number;
  /** Cell coverage, one byte each, row-major. */
  coverage: Uint8Array;
  /** Per-cell quadrant coverage [TL, TR, BL, BR] — the trim pass's own signal. */
  quad: Uint8Array;
  /** The same glyph at the same weight, drawn with room to spare and reduced back down: the picture
   *  the built letter is compared against. */
  reference: Uint8Array;
  /** The same letter drawn WITHOUT the placement search, at the region's own resolution: what the
   *  rasterizer would have produced before the grid fit existed. */
  centred: Uint8Array;
  /** And the same, drawn with room to spare and reduced down: a reference the search did not place.
   *  The pair is what lets the search be judged by something outside itself. */
  fixedReference: Uint8Array;
  /** How many separate pieces of the drawing each row and column of the REGION's grid crosses,
   *  counted at the reference's FULL resolution. The one reading a same-weight reference cannot give:
   *  a weight that fuses two strokes fuses them in the reference too. */
  runsRow: number[];
  runsCol: number[];
  /** The glyph's own topology, counted at the reference's FULL resolution — how many pieces the face
   *  draws it in, and how many counters it encloses. Read there rather than off the reduction: a
   *  light stroke at ten cells averages below half a cell, and the reduced picture would arrive
   *  broken into a dozen pieces and be the thing declared correct. */
  pieces: number;
  counters: number;
}

/** The committed rasters as they are stored: byte arrays base64'd, since a matrix of glyph rasters
 *  written out as JSON numbers is several megabytes of commas. */
export interface RasterFixtureFile {
  /** The font stack the rasters were drawn with, so a fixture taken against a different face is
   *  recognisable rather than silently compared. */
  font: string;
  generated: string;
  /** How many times the region's own resolution the reference was drawn at before being reduced. */
  referenceScale: number;
  entries: {
    text: string; width: number; height: number; weight: number;
    /** Coverage bytes, base64. */
    coverage: string; quad: string; centred: string;
    /** Masks, one BIT per cell, base64. */
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

/** The face's own picture at this resolution, before any of the processing — the thing the engine is
 *  judged against for topology. What the REFERENCE says is the letter's true shape; what this says is
 *  the most the region can hold, and the two differ where a counter simply has no cell to be. */
export function rawMask(fixture: RasterFixture): Mask {
  return maskOf(fixture.width, fixture.height, (i) => fixture.coverage[i]! >= COVERAGE_ON);
}

export function referenceMask(fixture: RasterFixture): Mask {
  return maskOf(fixture.width, fixture.height, (i) => fixture.reference[i]! > 0);
}

/**
 * DOES THE PLACEMENT SEARCH EARN ITS KEEP, asked in a way it cannot answer for itself.
 *
 * Every other number here compares a fitted letter with a fitted reference, which is the only fair
 * comparison of SHAPE and is silent on whether the fit helped, since the fit placed both pictures. So
 * this measure takes neither: the ANSWER is the ink the face actually drew, in cells, which is what
 * `coverage` already is — a cell's coverage is the integral of the drawing over that cell, so summing
 * it is the drawn area exactly, and the two placements draw the same letter. What a quantised picture
 * can then get wrong is carrying the wrong AMOUNT of it, which is precisely how a letter goes thin: a
 * bar landing between two rows is two rows of half coverage, both dropped, and the ink is gone.
 *
 * NO PLACEMENT ENTERS THE ANSWER, which is what makes this the one non-circular reading in the file.
 * An IoU against a high-resolution reference cannot be that, however the reference is drawn: it has to
 * be placed somewhere, and whichever sub-cell phase it takes, the raster sharing that phase scores
 * better for sharing it rather than for being truer. The fixed-placement reference the fixture carries
 * is kept for exactly that demonstration.
 *
 * Returns each placement's fidelity as 1 minus its area error, so 1 is a picture carrying exactly the
 * ink that was drawn and lower is a picture that dropped or invented some.
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
  // Averaged over the two, since a glyph shifted to the edge of its box can lose a sliver of ink to
  // the border and the two placements are not shifted alike.
  const drawn = Math.max(1e-6, (area(fixture.coverage) + area(fixture.centred)) / 2);
  const fidelity = (built: number): number => 1 - Math.abs(built - drawn) / drawn;
  return { fitted: fidelity(finish(fixture.coverage)), centred: fidelity(finish(fixture.centred)) };
}

/** A blank buildable map with a margin around the stencil, so nothing is judged against the edge of
 *  the world. */
function freshMap(width: number, height: number): GridState {
  const zones: CellZone[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => CellZone.Grass));
  const template: MapTemplate = {
    id: 'stencil-eval', name: { en: 'Stencil eval', zh: '模板评估' },
    width, height, zones,
    plaza: { x: 0, y: 0, width: 0, height: 0, elevation: 0 },
  };
  return { template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set() };
}

export const STENCIL_MARGIN = 3;

export interface BuiltGlyph {
  state: GridState;
  origin: { x: number; y: number };
  /** The stencil as the generator received it: the raster, repaired and capped. */
  stencil: Stencil;
  /** The terrain the run actually left standing, in stencil coordinates. Real blocks only — a Γ
   *  fillet is cosmetic and carries no mass, so counting one as ink would call a broken letter
   *  whole. */
  ink: Mask;
  /** Cosmetic fillets the trim pass added, same coordinates. */
  patches: Mask;
  corners: (Corners | null)[];
  violations: number;
}

/**
 * A stored raster taken all the way to committed terrain, through the pipeline the shelf runs: the
 * glyph processing, the stencil plan, and the generator's own corner-trim pass.
 */
export function buildGlyph(fixture: RasterFixture): BuiltGlyph {
  const stencil = stencilOf(fixture);
  finishGlyph(stencil);
  const state = freshMap(fixture.width + STENCIL_MARGIN * 2, fixture.height + STENCIL_MARGIN * 2);
  const origin = { x: STENCIL_MARGIN, y: STENCIL_MARGIN };
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const config: GenerateConfig = {
    algorithm: 'stencil', mode: 'mixed', corridorWidth: 1, maxElevation: 8, seed: 1, region: null,
    stencilPlan: { read: 'shape', fill: { kind: 'terrain', terrain: TerrainType.Mountain }, stencil, origin },
  };
  exec.runSilently(() => { generateTerrain(config, state, (c) => exec.execute(c), exec.getRegistry()); });
  const violations = exec.commitStrokeGroup(0).length;

  const { width: fw, height: fh } = fixture;
  const corners: (Corners | null)[] = [];
  const ink = maskOf(fw, fh, () => false);
  const patches = maskOf(fw, fh, () => false);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const t = state.cells[origin.y + y]?.[origin.x + x]?.terrain;
      const i = y * fw + x;
      corners.push(t?.corners ? [...t.corners] as Corners : null);
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
  /** Pieces that would be whole if a corner touch counted — the ink that fell apart into blocks. */
  cornerOnly: number;
  counters: number;
  /** The counters the face's own raster holds at this size, and the counters the letter really has.
   *  Processing is answerable for the first; the gap between the two is the region's resolution. */
  countersHeld: number;
  countersWanted: number;
  width: { median: number; spread: number; max: number };
  /** The cap the stroke cap was holding the letter to, for the width beside it to be read against. */
  target: number;
  nubs: number;
  notches: number;
  isolated: number;
  /** Cells standing alone in the face's OWN raster at this size — at ten cells a dot in an ideograph
   *  is one cell and has nowhere to touch. Only what the processing ADDS to that is a defect. */
  isolatedHeld: number;
  iou: number;
  recall: number;
  /** What the reference's straight edges came out as: how many there were, the worst wobble in cells,
   *  and how many scanlines of them the built letter left empty. */
  straight: Straightness;
  /** How much of the drawing's stroke separation survived, 1 being all of it. */
  separation: number;
  /** The runs the drawing itself crosses, for the reading that only applies to a letter of more than
   *  one stroke. */
  runsWanted: number[];
  /** How much of the letter's own box is ink: the reading behind "the stroke is too bold". */
  density: number;
  /** Whether the region this was drawn in is under the floor the text itself asks for
   *  (`stencil.ts:textMinBox`). Those cells are in the matrix ON PURPOSE — a floor is only worth
   *  anything if what lies under it is measured too — and they are reported rather than failed. */
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
  // The cells the FACE put ink in, by the same bar the glyph finishing fills a notch under: what it
  // refuses to fill is not damage this can count (`stencil.ts:TOUCHED_INK`).
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
 * The thresholds a built letter has to clear, read off rendered contact sheets rather than picked as
 * round numbers.
 *
 *  - BROKEN is absolute. A letter in more pieces than the face draws it in, a counter closed or a
 *    counter opened, or one cell of ink standing alone: each of those is an illegible letter, and
 *    none of them is a matter of degree.
 *  - RAGGED is per cell of ink, since a big letter has more outline to be ragged along. A nub or a
 *    notch every fifty cells reads as texture; a letter that reads as strange runs an order of
 *    magnitude over that.
 *  - RECALL, not IoU, carries the fidelity floor. The stroke width is not the face's, so a thinner
 *    letter is a lower IoU by construction; what may not happen is a piece of the glyph
 *    going missing, which is what the reference's own ridge asks about.
 */
export const STENCIL_THRESHOLDS = {
  raggedPerCell: 0.02,
  recall: 0.9,
  /** The two the SHELF also refuses a card on, taken from the engine so the matrix and the app cannot
   *  disagree about what is legible (`tools/generation/stencil/stencil.ts:GLYPH_LEGIBLE`). */
  separation: GLYPH_LEGIBLE.separation,
  density: GLYPH_LEGIBLE.density,
  /** How far a built edge may stray from the straight line it should be, in cells. Under half a cell
   *  is the only answer a grid can give: a quantised edge is either on a cell or on the next one, so
   *  a deviation at or under 0.5 is a run that never left its line and anything above it is a cell
   *  that stepped out and came back — the wobble a reader sees as a mistake. */
  straightDeviation: 0.5,
} as const;

export function glyphFailures(s: GlyphScore): string[] {
  // UNDER THE FLOOR IS NOT A FAILURE, it is the reason the floor is where it is: an ideograph in ten
  // cells has strokes the face's own raster could not hold, and no pass downstream can put them back.
  if (s.underFloor) return [];
  const out: string[] = [];
  if (s.pieces > s.piecesWanted) out.push(`${s.pieces} pieces, wanted ${s.piecesWanted}`);
  // Against what the face DREW here, not against the letter's true count: a counter with no cell to
  // be at ten cells is the region's resolution and no pass can conjure it, while a counter the raster
  // held and the processing closed is a defect this code owns.
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
  // A letter with ONE stroke fills its own box by definition, so the density bar is asked of letters
  // the drawing gave more than one to.
  if (s.density > STENCIL_THRESHOLDS.density && Math.max(...s.runsWanted) > 1) {
    out.push(`${(100 * s.density).toFixed(0)}% of the letter's box is ink`);
  }
  if (s.violations) out.push(`${s.violations} post-stroke violations`);
  return out;
}
