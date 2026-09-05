/**
 * HOW WELL THE MAP READS AS THE PICTURE — the measures the image-stencil matrix is scored on, and
 * the plumbing that runs a picture through the real generator to get something to measure.
 *
 * Shared by the committed tests and by the evaluation harness, exactly as `_stencil-metrics.ts` is
 * for text, so a threshold in a test and a number in the log are the same arithmetic.
 *
 * WHY NOT DISTANCE TO THE SOURCE'S COLOURS. That is the measure `stencil-fidelity.test.ts` uses,
 * and it is the right one for a SAMPLER: it says whether the reduction kept what was under each
 * cell. It is the wrong one for the map. The terrain ramp is eight greens and the picture is pink;
 * every possible result is far away in colour and the number cannot tell a face from a flat slab —
 * which is precisely the failure it was measured through. What a viewer reads instead is where the
 * light and dark FALL and how far they move, so the headline is those two together (`fidelity`),
 * over the whole picture, with a cell nothing was built on counting as the ground it stayed.
 */
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';
import { ELEVATION_COLORS, ZONE_COLORS, WATER_COLOR } from '../../../../core/model/constants';
import { hexStringToNumber } from '../../../../core/model/colors';
import { CellZone, TerrainType, type EditorEvents, type GridState, type MacroCoord, type Stencil, type StencilWaterRole } from '../../../../core/model/types';
import { buildingCrop, cropPixels, stencilFromPixels, type SampleOptions, type SourcePixels } from '../../../../tools/generation/stencil/stencil-sample';
import { layStencilColor, layStencilDecor, layStencilObjectColor, type StencilResult } from '../../../../tools/generation/stencil/stencil-generator';
import { COVERAGE_ON, luma, paletteToneRange, sourceToneRange, terrainPalette, type ToneRange } from '../../../../tools/generation/stencil/stencil';
import { detectFeatures, featureBudget, planFeatureMarks, FEATURE_MAX } from '../../../../tools/generation/stencil/stencil-feature';
import { getCatalogItem } from '../../../../state/catalog';
import { makeState } from '../../../rules/_helpers';

/** Optional decoded-image fixtures. The dependent cases skip when the fixture set is absent. */
export const IMAGE_FIXTURE_FILE = 'docs/internal/generator_iteration_guide/stencil-fixtures/decoded.json';

export interface FixtureImage extends SourcePixels { name: string; what: string }

/** What an untouched cell draws in — a real answer a picture can give, so it belongs in the palette
 *  every score is measured against. */
export const GROUND = hexStringToNumber(ZONE_COLORS[CellZone.Grass]!);

/** What the map draws water in, which is what `waterShare` counts. */
export const WATER = hexStringToNumber(WATER_COLOR);

/** Unpack the palette-indexed, run-length-coded fixture data into RGBA. */
export function loadImageFixtures(json: string): FixtureImage[] {
  const file = JSON.parse(json) as {
    images: Record<string, { width: number; height: number; palette: string; runs: string; what: string }>;
  };
  const out: FixtureImage[] = [];
  for (const [name, entry] of Object.entries(file.images)) {
    const palette = base64Bytes(entry.palette);
    const runs = base64Bytes(entry.runs);
    const data = new Uint8Array(entry.width * entry.height * 4);
    let at = 0;
    for (let r = 0; r + 3 < runs.length; r += 4) {
      const index = runs[r]!, alpha = runs[r + 1]!, count = (runs[r + 2]! << 8) | runs[r + 3]!;
      for (let n = 0; n < count && at < entry.width * entry.height; n++, at++) {
        data[at * 4] = palette[index * 3]!;
        data[at * 4 + 1] = palette[index * 3 + 1]!;
        data[at * 4 + 2] = palette[index * 3 + 2]!;
        data[at * 4 + 3] = alpha;
      }
    }
    out.push({ name, what: entry.what, data, width: entry.width, height: entry.height });
  }
  return out;
}

function base64Bytes(text: string): Uint8Array {
  // Runs in node and in a browser alike, with no dependency on either one's own decoder.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0, held = 0, at = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) continue;
    held = (held << 6) | v;
    bits += 6;
    if (bits < 8) continue;
    bits -= 8;
    out[at++] = (held >> bits) & 0xff;
  }
  return out;
}

/** The colour the 2D map draws a cell in — the one measure of "what a viewer sees" that does not
 *  need a renderer. Grass where nothing was built. */
export function cellColor(state: GridState, x: number, y: number): number {
  const cell = state.cells[y]?.[x];
  if (!cell) return hexStringToNumber(ZONE_COLORS[CellZone.Grass]!);
  const t = cell.terrain;
  if (!t) return hexStringToNumber(ZONE_COLORS[cell.zone] ?? ZONE_COLORS[CellZone.Grass]!);
  if (t.type === TerrainType.Water) return hexStringToNumber(WATER_COLOR);
  return hexStringToNumber(ELEVATION_COLORS[t.elevation] ?? ZONE_COLORS[CellZone.Grass]!);
}

export interface ImageRun {
  stencil: Stencil;
  state: GridState;
  origin: { x: number; y: number };
  result: StencilResult;
  violations: number;
  /** The map's colour per cell of the stencil's own box, row-major. */
  built: number[];
  /** Share of the SOURCE's area the auto-trim dropped as building nothing: 0 where the picture
   *  already filled its own frame, and the resolution the subject gained where it did not. */
  trimmed: number;
}

export interface ImageRunOptions {
  /** Cells per side of the region. */
  side: number;
  /** Absent builds the picture in terrain; present tiles it with objects of these colours. */
  objects?: readonly { catalogId: string; rgb: number }[];
  /** The MIXED composition's second half: objects at the picture's anchor points, over whatever the
   *  primary left standing. Absent is a picture of one material throughout. */
  decor?: readonly { catalogId: string; rgb: number }[];
  maxElevation?: number;
  contrast?: number;
  /** What part water plays in the terrain reading. Absent is the green ramp alone. */
  water?: StencilWaterRole;
  sample?: SampleOptions;
  /** Off matches the picture's colours where they are — the un-fitted reading a score is compared
   *  against. */
  fitTones?: boolean;
  /**
   * The painted REGION, as a predicate in the stencil's own coordinates — absent is "the whole box".
   *
   * A region is not its bounding box, and every run here used the box, so nothing exercised the
   * `allow` set a real scoped run carries. Taken as a predicate rather than as flat indices so a
   * case can say the SHAPE it means and the map arithmetic stays in one place.
   */
  region?: (x: number, y: number) => boolean;
}

/** A picture built on an empty map through the REAL generator and the REAL rules, committed. */
export function runImage(src: SourcePixels, opts: ImageRunOptions): ImageRun {
  const { side } = opts;
  const sample = opts.sample ?? {};
  const stencil = stencilFromPixels(src, { width: side, height: side }, sample)!;
  const crop = sample.trim === false ? null : buildingCrop(src, { width: side, height: side }, sample);
  const trimmed = crop ? 1 - (crop.width * crop.height) / (src.width * src.height) : 0;
  const margin = 4;
  const state = makeState(side + margin * 2, side + margin * 2);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const origin = { x: margin, y: margin };
  const run = (c: Parameters<typeof executor.execute>[0]): ReturnType<typeof executor.execute> => executor.execute(c);
  const water = opts.water ?? 'none';
  let allow: ReadonlySet<number> | undefined;
  if (opts.region) {
    const cells = new Set<number>();
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        if (opts.region(x, y)) cells.add((origin.y + y) * state.template.width + origin.x + x);
      }
    }
    allow = cells;
  }
  const placement = { origin, stencil, ...(allow ? { allow } : {}) };
  const result = opts.objects?.length
    ? layStencilObjectColor(state, placement, opts.objects, run, opts.contrast ?? 1, opts.fitTones ?? true)
    : layStencilColor(state, placement, opts.maxElevation ?? 8, run, opts.contrast ?? 1, water, opts.fitTones ?? true);
  if (opts.decor?.length) {
    const laid = new Set(state.objects.keys());
    layStencilDecor(
      state, placement, { palette: opts.decor }, run, laid,
      opts.objects?.length ? opts.objects : terrainPalette(opts.maxElevation ?? 8, water === 'palette'),
    );
  }
  const violations = executor.commitStroke(0).length;
  const objectColor = new Map<number, number>();
  const shown = [...(opts.objects ?? []), ...(opts.decor ?? [])];
  if (shown.length) {
    const byId = new Map(shown.map((entry) => [entry.catalogId, entry.rgb]));
    for (const object of state.objects.values()) {
      const rgb = byId.get(object.catalogId);
      if (rgb !== undefined) objectColor.set(object.position.y * state.template.width + object.position.x, rgb);
    }
  }
  const built: number[] = [];
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const cx = origin.x + x, cy = origin.y + y;
      built.push(objectColor.get(cy * state.template.width + cx) ?? cellColor(state, cx, cy));
    }
  }
  return { stencil, state, origin, result, violations, built, trimmed };
}

/**
 * What the picture ITSELF is at this cell count: the plain area reading of its colours, with the
 * SUBJECT as the footprint — the reference every score is measured against, and NOT whatever reading
 * the run under test used.
 *
 * The colour is read as a photograph would be (a straight area average) because that is the truth of
 * what is under a cell whatever a sampler then chooses to do with it. The footprint is the subject
 * because a backdrop is not part of the picture: scoring a run over the whole rectangle rewards it
 * for paving the backdrop in the nearest colour.
 */
export function pictureTruth(src: SourcePixels, side: number, trim = true): Stencil {
  return stencilFromPixels(src, { width: side, height: side }, { nature: 'photographic', trim })!;
}

/**
 * The cells a backdrop pass would drop: covered by the picture's own alpha, not part of the subject.
 * Building on these is the paved-backdrop failure, and `spill` is what counts it.
 *
 * BOTH READINGS COME OFF ONE CROP, taken from the subject's. The two are compared cell for cell, and
 * a trim fitted to each of them separately is a different frame each: the alpha reading of a
 * photographed sticker reaches the paper's own edges and the subject's stops at the sticker, so the
 * grids would be measuring two different pictures at the same indices.
 */
export function backdropCells(src: SourcePixels, side: number, trim = true): boolean[] {
  const whole = pictureFootprint(src, side, trim);
  const subject = pictureTruth(src, side, trim);
  const out: boolean[] = [];
  for (let i = 0; i < side * side; i++) {
    out.push((whole.coverage[i] ?? 0) >= 128 && (subject.coverage[i] ?? 0) < 128);
  }
  return out;
}

/**
 * The picture's OWN INK at this cell count: the alpha reading, with no backdrop pass — every cell the
 * file draws anything in, whatever a keying decision then makes of it.
 *
 * On the same crop as `pictureTruth`, for the reason above. This is the footprint `presence` is taken
 * over, and the difference between the two readings is what tells a backdrop pass that dropped a
 * field from one that dropped the subject.
 */
export function pictureFootprint(src: SourcePixels, side: number, trim = true): Stencil {
  const box = { width: side, height: side };
  const crop = trim ? buildingCrop(src, box, { nature: 'photographic' }) : null;
  const base = crop ? cropPixels(src, crop) : src;
  return stencilFromPixels(base, box, { nature: 'photographic', background: false, trim: false })!;
}

export interface ImageScore {
  /** Cells the picture reaches at all. */
  cells: number;
  /** THE HEADLINE: the picture's pattern times its amplitude, 0 for a flat result or an unrelated
   *  one and 1 for a map that moves as much as the picture did and in the same places. */
  fidelity: number;
  /** Correlation between the picture's light and dark and the map's, over those cells. Kept beside
   *  the skill score as the diagnostic it is: high with a low fidelity means the map has the right
   *  pattern and nowhere near enough of it. */
  structure: number;
  /** How much of the palette the result actually uses, as entropy over the colours drawn against
   *  what the palette could have said. A flat slab is 0; this is what names a featureless blob. */
  spread: number;
  /** Share of the SUBJECT'S own cells that were left as ground — how much of the picture went
   *  missing. */
  bare: number;
  /** Share of the BACKDROP that was built on anyway. A region paved edge to edge reads 1 here, with
   *  the subject somewhere inside it. Every material answers 0 here,
   *  water included — a picture stands in the region rather than owning it. */
  spill: number;
  /**
   * Share of the SUBJECT that came back water — how much of the figure the material actually built.
   *
   * Measured over the picture's own cells rather than over the region, because that is the whole of
   * what a water build writes: the ground around a figure is left as it was, and counting it would
   * report the region's size rather than the material.
   */
  waterShare: number;
  violations: number;
}

/**
 * Score a run against the picture it came from.
 *
 * MEASURED OVER THE PICTURE'S WHOLE FOOTPRINT, including whatever a backdrop pass dropped: a cell
 * left as ground is a real answer (the map says "nothing here"), and scoring only the cells that
 * happened to be built would reward a run for building less. Ground is bright, so a bright backdrop
 * left alone is CORRECT by this measure and a bright backdrop paved dark is not, which is the
 * distinction that matters.
 */
export function scoreImage(
  run: ImageRun, truth: Stencil, palette: readonly number[], backdrop: readonly boolean[] = [],
): ImageScore {
  const n = truth.width * truth.height;
  const grass = GROUND;
  const source: number[] = [], built: number[] = [];
  const counts = new Map<number, number>();
  let bare = 0, water = 0;
  for (let i = 0; i < n; i++) {
    if ((truth.coverage[i] ?? 0) < 128) continue;
    source.push(luma(truth.color[i] ?? 0));
    const colour = run.built[i] ?? 0;
    built.push(luma(colour));
    counts.set(colour, (counts.get(colour) ?? 0) + 1);
    if (colour === grass) bare++;
    if (colour === WATER) water++;
  }
  let backdropCount = 0, painted = 0;
  for (let i = 0; i < n; i++) {
    if (!backdrop[i]) continue;
    backdropCount++;
    if ((run.built[i] ?? 0) !== grass) painted++;
  }
  return {
    cells: source.length,
    fidelity: fidelity(source, built, palette),
    structure: correlation(source, built),
    spread: entropy([...counts.values()], palette.length),
    bare: source.length === 0 ? 0 : bare / source.length,
    spill: backdropCount === 0 ? 0 : painted / backdropCount,
    waterShare: source.length === 0 ? 0 : water / source.length,
    violations: run.violations,
  };
}

/**
 * How much of the picture the map carries: its PATTERN times its AMPLITUDE, each of the two series
 * measured against the range it can move in.
 *
 * The two halves of SSIM that survive a palette change of hue, and no more than that. Pattern alone
 * scores 0.83 on a paved square with six specks in it: a correlation has no scale, so a handful of correct variation over a flat field reads as a good one.
 * Amplitude alone cannot tell a picture from noise. Their product is 0 when the result is flat, 0
 * when it is unrelated, and 1 only when the map moves as much as the picture did and in the same
 * places.
 *
 * NOT MEASURED AGAINST AN IDEAL RENDERING, which is unfair by construction: a one-cell outline at the edge of a shape cannot stand eight layers up (V-MTN-03 has ground on the
 * other side of it), so the deepest tiers are unreachable for exactly the features that want them
 * and every result scores as a failure. Relative amplitude asks the question the geometry can
 * actually answer.
 */
export function fidelity(source: readonly number[], built: readonly number[], palette: readonly number[]): number {
  if (source.length < 2) return 0;
  const from = sourceToneRange(source), to = paletteToneRange(palette.map((rgb) => ({ rgb })));
  const unit = (v: number, range: ToneRange): number =>
    (range.hi - range.lo < 1 ? 0.5 : Math.min(1, Math.max(0, (v - range.lo) / (range.hi - range.lo))));
  const s = source.map((v) => unit(v, from)), b = built.map((v) => unit(v, to));
  const spreadOf = (series: readonly number[]): number => {
    const mean = series.reduce((sum, v) => sum + v, 0) / series.length;
    return Math.sqrt(series.reduce((sum, v) => sum + (v - mean) ** 2, 0) / series.length);
  };
  const ss = spreadOf(s), sb = spreadOf(b);
  if (ss <= 0) return 0;
  const amplitude = (2 * ss * sb) / (ss * ss + sb * sb);
  return Math.max(0, correlation(s, b) * amplitude);
}

/** Pearson's r, with a flat series scoring 0 rather than dividing by nothing — which is exactly what
 *  a result that came out as one tier is worth. */
export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]!; sb += b[i]!; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma, db = b[i]! - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}

/**
 * Shannon entropy of a distribution against `slots` — how many things the palette COULD have said,
 * not how many it did. Dividing by the latter would score two colours used evenly the same as
 * eight, which is the distinction this measure exists to make.
 */
export function entropy(counts: readonly number[], slots: number): number {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total <= 0 || slots < 2) return 0;
  let h = 0;
  for (const n of counts) {
    if (n <= 0) continue;
    const p = n / total;
    h -= p * Math.log2(p);
  }
  return Math.min(1, h / Math.log2(slots));
}

/* ── the legibility reading ─────────────────────────────────────────────────────────────────────
 *
 * WHY THERE IS A SECOND SCORE AT ALL. Everything above answers "did the reduction keep the picture's
 * light and dark". It answers it well and it cannot see LEGIBILITY: over a fourfold change in cell
 * count, where a picture goes from unmistakable to unreadable, `fidelity` moves about a tenth, and it
 * has two blind spots that print as ordinary numbers. A source with no tonal variation has nothing to
 * correlate, so it scores exactly 0 at every size whatever the map does. And a subject the sampler
 * DISCARDED is scored against a reference that discards the same cells, so a run that built nothing
 * at all is measured over an empty footprint and reads 0 for a reason the number does not name.
 *
 * These four measures are each MONOTONE with one named failure, and each is a share, so a flat source
 * and an empty result both produce a real number:
 *
 *   presence         the picture's ink that got built on at all — 0 when the backdrop ate the subject
 *   regionSurvival   the source's coherent colour AREAS that arrived as coherent areas
 *   waterCohesion    the result's water that sits in bodies rather than in specks
 *   hueSeparability  the source's hue-separated, equally-light areas that landed on different colours
 */

/** How many cells make an AREA rather than a speck — of a source colour, of a built tier, of water.
 *  Three is the smallest count that can hold a shape at all. */
export const REGION_MIN = 3;

/** How much of a source area has to arrive as ONE coherent built area for the area to have survived.
 *  Half: below that what is left is a fragment of the feature, which is the failure being measured. */
export const REGION_KEPT = 0.5;

/** How close in lightness two source areas must be for the eye to need their HUE to tell them apart
 *  (0-255 luma), and how far apart in hue (degrees) they must be to count as separated at all. */
export const HUE_LUMA_NEAR = 24;
export const HUE_FAR = 40;
/** And how coloured each of them has to be: a grey has no hue to be separated by. */
export const HUE_CHROMA_MIN = 30;

/**
 * A colour reduced to five bits a channel — the granularity source AREAS are counted at.
 *
 * The measure's own choice rather than the sampler's: what is being counted is areas a viewer would
 * read as one colour, so near-identical shades (a JPEG's noise, a scaler's blend) must share a label.
 */
const quantise = (rgb: number): number =>
  ((((rgb >> 19) & 0x1f) << 10) | (((rgb >> 11) & 0x1f) << 5) | ((rgb >> 3) & 0x1f)) >>> 0;

/** Hue in degrees, and chroma as the channel spread — enough of HSV for "is this a different colour
 *  or the same colour darker". */
function hueOf(rgb: number): { hue: number; chroma: number } {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c === 0) return { hue: 0, chroma: 0 };
  const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return { hue: ((h * 60) % 360 + 360) % 360, chroma: c };
}

const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * The 4-connected components of cells sharing a label, as index lists — the one piece of arithmetic
 * three of the four measures are built on.
 *
 * `label` returns null for a cell that is not in play (outside the subject, not water, not built).
 */
export function sameLabelRegions(
  width: number, height: number, label: (index: number) => number | null,
): number[][] {
  const seen = new Uint8Array(width * height);
  const out: number[][] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start]) continue;
    const own = label(start);
    seen[start] = 1;
    if (own === null) continue;
    const region = [start];
    const stack = [start];
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i / width) | 0;
      const around = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const n of around) {
        if (n < 0 || seen[n]) continue;
        if (label(n) !== own) continue;
        seen[n] = 1;
        region.push(n);
        stack.push(n);
      }
    }
    out.push(region);
  }
  return out;
}

/** The largest 4-connected run of ONE built colour inside a given set of cells — how much of a source
 *  area arrived as a single area. Walks the set itself rather than the grid: this is asked once per
 *  source area and a whole-grid pass per area is the matrix's own running time. */
function largestRunWithin(cells: readonly number[], width: number, built: readonly number[]): number {
  const own = new Set(cells);
  const seen = new Set<number>();
  let best = 0;
  for (const start of cells) {
    if (seen.has(start)) continue;
    const colour = built[start] ?? GROUND;
    seen.add(start);
    let size = 0;
    const stack = [start];
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      for (const n of [x > 0 ? i - 1 : -1, i + 1, i - width, i + width]) {
        if (n < 0 || (n === i + 1 && n % width === 0)) continue;
        if (!own.has(n) || seen.has(n) || (built[n] ?? GROUND) !== colour) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    if (size > best) best = size;
  }
  return best;
}

export interface LegibilityScore {
  /**
   * Share of the picture's OWN INK (`pictureFootprint`) that the run built anything on.
   *
   * 0 means the picture did not arrive: either nothing was laid, or a backdrop pass keyed the subject
   * out before the generator saw it. Read beside `bare`, which is the same share over the subject the
   * sampler KEPT: `presence` far below `1 - bare` is the keying having taken ink with it.
   */
  presence: number;
  /** Cells of ink the presence is taken over. 0 is the only "not measurable" here. */
  footprintCells: number;
  /**
   * Area-weighted share of the source's coherent colour areas that arrived as ONE coherent built
   * area covering at least half of themselves — feature starvation, as a number per case.
   */
  regionSurvival: number;
  /** The two counts behind it: coherent areas (>= REGION_MIN cells) in the source's reading, and in
   *  the result, both over the subject. */
  sourceRegions: number;
  resultRegions: number;
  /** Share of the result's water that sits in bodies of REGION_MIN cells or more. A case with no
   *  water is vacuously cohesive at 1; condition an average on `waterCells`. */
  waterCohesion: number;
  waterCells: number;
  /** Share of the source's hue-separated, equally-light area pairs that landed on DIFFERENT colours.
   *  A monochrome subject offers no such pair; condition an average on `huePairs`. */
  hueSeparability: number;
  huePairs: number;
}

/**
 * Read a run for LEGIBILITY: the four measures above, over one case.
 *
 * `truth` is the subject as the picture itself reads at this cell count (`pictureTruth`) and
 * `footprint` is the picture's ink whatever the keying did with it (`pictureFootprint`). Both are
 * needed and they are not interchangeable — that difference is the backdrop failure.
 */
export function scoreLegibility(
  built: readonly number[], truth: Stencil, footprint: Stencil,
): LegibilityScore {
  const { width, height } = truth;
  const n = width * height;
  const inSubject = (i: number): boolean => (truth.coverage[i] ?? 0) >= COVERAGE_ON;
  const laid = (i: number): boolean => (built[i] ?? GROUND) !== GROUND;

  let ink = 0, inkBuilt = 0;
  for (let i = 0; i < n; i++) {
    if ((footprint.coverage[i] ?? 0) < COVERAGE_ON) continue;
    ink++;
    if (laid(i)) inkBuilt++;
  }

  const source = sameLabelRegions(width, height, (i) => (inSubject(i) ? quantise(truth.color[i] ?? 0) : null))
    .filter((r) => r.length >= REGION_MIN);
  const result = sameLabelRegions(width, height, (i) => (inSubject(i) ? (built[i] ?? GROUND) : null))
    .filter((r) => r.length >= REGION_MIN);

  // A source area SURVIVED when the result holds one connected same-colour run over at least half of
  // it. Measured inside the area rather than over the map, so a feature that merged into the mass
  // around it does not score as kept.
  let areaAll = 0, areaKept = 0;
  for (const region of source) {
    const largest = largestRunWithin(region, width, built);
    areaAll += region.length;
    if (largest >= Math.max(REGION_MIN, region.length * REGION_KEPT)) areaKept += region.length;
  }

  const water = sameLabelRegions(width, height, (i) => ((built[i] ?? GROUND) === WATER ? 1 : null));
  const waterCells = water.reduce((sum, r) => sum + r.length, 0);
  const inBodies = water.filter((r) => r.length >= REGION_MIN).reduce((sum, r) => sum + r.length, 0);

  return {
    presence: ink === 0 ? 0 : inkBuilt / ink,
    footprintCells: ink,
    regionSurvival: areaAll === 0 ? 0 : areaKept / areaAll,
    sourceRegions: source.length,
    resultRegions: result.length,
    waterCohesion: waterCells === 0 ? 1 : inBodies / waterCells,
    waterCells,
    ...hueSeparability(built, truth),
  };
}

/**
 * Whether areas the SOURCE separates by hue at the same lightness arrive as different colours.
 *
 * The terrain ramp is eight greens and one blue, so two areas a viewer tells apart by colour alone
 * can only arrive as one tier — and nothing above can see it, because the two areas have the same
 * luma and a luma measure is all `fidelity` is. Pairs, not cells: the failure is a RELATION between
 * two areas, and it is present exactly when the map draws them the same.
 */
function hueSeparability(
  built: readonly number[], truth: Stencil,
): { hueSeparability: number; huePairs: number } {
  const n = truth.width * truth.height;
  const areas = new Map<number, { cells: number[]; r: number; g: number; b: number }>();
  for (let i = 0; i < n; i++) {
    if ((truth.coverage[i] ?? 0) < COVERAGE_ON) continue;
    const rgb = truth.color[i] ?? 0;
    const key = quantise(rgb);
    const area = areas.get(key);
    if (area) { area.cells.push(i); area.r += (rgb >> 16) & 0xff; area.g += (rgb >> 8) & 0xff; area.b += rgb & 0xff; }
    else areas.set(key, { cells: [i], r: (rgb >> 16) & 0xff, g: (rgb >> 8) & 0xff, b: rgb & 0xff });
  }
  const kept = [...areas.values()]
    .filter((a) => a.cells.length >= REGION_MIN)
    .map((a) => {
      const size = a.cells.length;
      const rgb = ((Math.round(a.r / size) << 16) | (Math.round(a.g / size) << 8) | Math.round(a.b / size)) >>> 0;
      // The area's own commonest built colour: what the map says this area IS.
      const counts = new Map<number, number>();
      for (const i of a.cells) counts.set(built[i] ?? GROUND, (counts.get(built[i] ?? GROUND) ?? 0) + 1);
      let drawn = GROUND, most = -1;
      for (const [colour, count] of counts) if (count > most) { most = count; drawn = colour; }
      return { ...hueOf(rgb), luma: luma(rgb), drawn };
    })
    .filter((a) => a.chroma >= HUE_CHROMA_MIN);

  let pairs = 0, separated = 0;
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const a = kept[i]!, b = kept[j]!;
      if (Math.abs(a.luma - b.luma) > HUE_LUMA_NEAR || hueGap(a.hue, b.hue) < HUE_FAR) continue;
      pairs++;
      if (a.drawn !== b.drawn) separated++;
    }
  }
  return { hueSeparability: pairs === 0 ? 1 : separated / pairs, huePairs: pairs };
}

/**
 * WHETHER THE DECORATION WAS SPENT ON ANYTHING — the reading no measure above can take.
 *
 * The decoration is the one instrument in a terrain picture that carries a real hue (`stencil-feature.ts`
 * states why that makes it scarce), and a pass that spreads it over the picture's strongest gradients is
 * legal, even, deterministic and about nothing. These numbers say where the marks LANDED against the
 * features the SOURCE actually has, read by the engine's own `detectFeatures`, so the measure and the
 * decision are one question rather than two readings that might disagree.
 */
export interface PurposeScore {
  /** Share of the run's decoration marks standing ON a cell of one of the top features. A scattered pass
   *  scores about `featureShare`, which is a few per cent; a purposeful one scores near 1. */
  onFeature: number;
  /** The same share counting a mark one cell OFF a feature. A feature is a colour boundary and so a tier
   *  boundary, and a flat placement is refused beside a step, so the decor pass stands such a mark
   *  beside the feature: `onFeature` is the strict reading and this is what the pass could say. */
  nearFeature: number;
  /** Share of the top features with at least one mark on or beside them — whether the marks are spread
   *  over the features or piled on one. */
  featuresSaid: number;
  /** Features the source offers at all, and how many of them the budget could reach. */
  features: number;
  topFeatures: number;
  /** Cells the plan asked for, and marks actually standing: the gap is what the rules refused. */
  planned: number;
  marks: number;
  /** What a figure this size may carry (`featureBudget`). */
  budget: number;
  /** Share of the figure the top features cover: what `onFeature` would be if the marks fell at random. */
  featureShare: number;
  /** Coatings this run laid, which are objects too — a picture's load on a chunk is the decoration plus
   *  the borrowed paving (`planBorrow`). */
  coatings: number;
}

/**
 * Read a finished run for decoration purposefulness.
 *
 * `objects` is what THIS RUN laid, and the caller is what knows that: a map arrives with its template's
 * plaza on it, whose own position can fall inside the picture's box, and an object nobody's run placed is
 * not a statement about the picture. Anything outside the box is dropped here as well. A COATING is told
 * apart from a mark by its trait, because the two are different instruments: a borrowed paving says a
 * whole region's colour and a mark says one feature's.
 */
export function scorePurpose(
  objects: readonly { position: MacroCoord; catalogId: string }[],
  stencil: Stencil,
  origin: MacroCoord,
  primary: readonly { rgb: number }[],
  accent: readonly { catalogId: string; rgb: number }[],
): PurposeScore {
  const { width, height } = stencil;
  const inFigure = (i: number): boolean => (stencil.coverage[i] ?? 0) >= COVERAGE_ON;
  let figure = 0;
  for (let i = 0; i < width * height; i++) if (inFigure(i)) figure++;
  const features = detectFeatures(stencil, inFigure, primary, accent);
  const plan = planFeatureMarks(features, accent, featureBudget(figure));
  const top = features.slice(0, FEATURE_MAX);

  const owner = new Map<number, number>();
  for (const [at, feature] of top.entries()) for (const i of feature.cells) owner.set(i, at);
  const near = new Map<number, number>(owner);
  for (const [i, at] of owner) {
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!near.has(ny * width + nx)) near.set(ny * width + nx, at);
    }
  }

  let marks = 0, on = 0, beside = 0, coatings = 0;
  const said = new Set<number>();
  for (const object of objects) {
    const x = object.position.x - origin.x, y = object.position.y - origin.y;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const item = getCatalogItem(object.catalogId);
    if (!item) continue;
    if (item.traits?.some((trait) => trait.type === 'surfaceCoating')) { coatings++; continue; }
    marks++;
    const i = y * width + x;
    if (owner.has(i)) on++;
    const around = near.get(i);
    if (around !== undefined) { beside++; said.add(around); }
  }
  return {
    onFeature: marks === 0 ? 0 : on / marks,
    nearFeature: marks === 0 ? 0 : beside / marks,
    featuresSaid: top.length === 0 ? 0 : said.size / top.length,
    features: features.length,
    topFeatures: top.length,
    planned: plan.reduce((sum, mark) => sum + mark.want, 0),
    marks,
    budget: featureBudget(figure),
    featureShare: figure === 0 ? 0 : owner.size / figure,
    coatings,
  };
}
