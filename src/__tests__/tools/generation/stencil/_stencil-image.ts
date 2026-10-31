/**
 * How well the map reads as the picture: the image-stencil measures, and the plumbing that runs a
 * picture through the real generator. The tests and the evaluation harness share it.
 *
 * Colour distance, right for a sampler, is wrong for the map: the terrain ramp is eight greens, so
 * every result is far from a pink picture and a face scores like a flat slab. A viewer reads where
 * light and dark fall and how far they move, so the headline (`fidelity`) is those two together,
 * with an unbuilt cell counting as the ground it stayed.
 */
import { createDefaultRegistry } from '../../../../rules';
import { ELEVATION_COLORS, ZONE_COLORS, WATER_COLOR } from '../../../../core/model/palette';
import { hexStringToNumber } from '../../../../core/base/color';
import { TerrainType, type GridState, type MacroCoord } from '../../../../core/model/types';
import { type Stencil, type StencilWaterRole } from '../../../../tools/generation/recipe';
import { CellZone } from '../../../../core/game/zones';
import { sampleStencil, stencilFromPixels, type SampleOptions, type SourcePixels } from '../../../../tools/generation/stencil/stencil-sample';
import { cropPixels } from '../../../../tools/generation/stencil/stencil-crop';
import { layStencilColor, layStencilDecor, layStencilObjectColor, type StencilResult } from '../../../../tools/generation/stencil/stencil-generator';
import { COVERAGE_ON, paletteToneRange, sourceToneRange, terrainPalette, type ToneRange } from '../../../../tools/generation/stencil/stencil';
import { luma } from '../../../../tools/generation/stencil/color';
import { detectFeatures, featureBudget, planFeatureMarks, FEATURE_MAX } from '../../../../tools/generation/stencil/stencil-feature';
import { getCatalogItem } from '../../../../state/catalog';
import { makeState } from '../../../_support/map-state';
import { createExecutor } from '../../../../state/executor';

/** The terrain ramp every image score is measured against, one RGB value per layer. */
export const RAMP = terrainPalette(8, false).map((entry) => entry.rgb);

/** The region sides, in cells, the picture cases are built at. */
export const SIZES = [20, 28, 40];

export interface FixtureImage extends SourcePixels { name: string; what: string }

/** What an untouched cell draws in; a real answer, so it belongs in every score's palette. */
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

/** The colour the 2D map draws a cell in, grass where nothing was built. */
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
  /** Share of the source's area the auto-trim dropped; 0 where the picture filled its frame. */
  trimmed: number;
}

export interface ImageRunOptions {
  /** Cells per side of the region. */
  side: number;
  /** Absent builds the picture in terrain; present tiles it with objects of these colours. */
  objects?: readonly { catalogId: string; rgb: number }[];
  /** Objects at the picture's anchor points over the primary build; absent is one material only. */
  decor?: readonly { catalogId: string; rgb: number }[];
  maxElevation?: number;
  contrast?: number;
  /** What part water plays in the terrain reading. Absent is the green ramp alone. */
  water?: StencilWaterRole;
  sample?: SampleOptions;
  /** Off keeps the picture's colours where they are, the unfitted baseline. */
  fitTones?: boolean;
  /** The painted region in the stencil's coordinates, passed to the generator as `allow`; absent is
   *  the whole box. */
  region?: (x: number, y: number) => boolean;
}

/** A picture built on an empty map through the real generator and rules, committed. */
export function runImage(src: SourcePixels, opts: ImageRunOptions): ImageRun {
  const { side } = opts;
  const sample = opts.sample ?? {};
  const { stencil, trim: crop } = sampleStencil(src, { width: side, height: side }, sample)!;
  const trimmed = crop ? 1 - (crop.width * crop.height) / (src.width * src.height) : 0;
  const margin = 4;
  const state = makeState(side + margin * 2, side + margin * 2);
  const executor = createExecutor(state, createDefaultRegistry());
  const whole = executor.beginStroke();
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
    ? layStencilObjectColor(state, placement, opts.objects, run, { contrast: opts.contrast ?? 1, fitTones: opts.fitTones ?? true })
    : layStencilColor(state, placement, run, {
      maxElevation: opts.maxElevation ?? 8, contrast: opts.contrast ?? 1, water: water ?? 'none', fitTones: opts.fitTones ?? true,
    });
  if (opts.decor?.length) {
    const laid = new Set(state.objects.keys());
    layStencilDecor(
      state, placement, { palette: opts.decor }, run,
      { replaceable: laid, primary: opts.objects?.length ? opts.objects : terrainPalette(opts.maxElevation ?? 8, water === 'palette') },
    );
  }
  const violations = whole.commit().length;
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
 * The reference every score is measured against: the picture's straight area average at this cell
 * count, whatever the run's sampler chose, with the subject as the footprint so that paving the
 * backdrop earns nothing.
 */
export function pictureTruth(src: SourcePixels, side: number, trim = true): Stencil {
  return stencilFromPixels(src, { width: side, height: side }, { nature: 'photographic', trim })!;
}

/**
 * The cells a backdrop pass would drop: inside the picture's alpha but not the subject; `spill` counts
 * building on them. Both readings share the subject's crop, since a trim fitted to each would frame a
 * photographed sticker differently and misalign the grids.
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
 * The picture's ink at this cell count: every cell the file draws in, before any backdrop pass, on
 * `pictureTruth`'s crop. `presence` is taken over it; its difference from `pictureTruth` tells a pass
 * that dropped a field from one that dropped the subject.
 */
export function pictureFootprint(src: SourcePixels, side: number, trim = true): Stencil {
  const box = { width: side, height: side };
  const crop = trim ? sampleStencil(src, box, { nature: 'photographic' })!.trim : null;
  const base = crop ? cropPixels(src, crop) : src;
  return stencilFromPixels(base, box, { nature: 'photographic', background: false, trim: false })!;
}

export interface ImageScore {
  /** Cells the picture reaches at all. */
  cells: number;
  /** The headline, `fidelity`: 0 for a flat or unrelated result, 1 for a map that moves as much as
   *  the picture and in the same places. */
  fidelity: number;
  /** Correlation of the picture's luma with the map's; high beside a low fidelity means the right
   *  pattern at too little amplitude. */
  structure: number;
  /** Entropy of the colours drawn against the palette's size; a flat slab is 0. */
  spread: number;
  /** Share of the subject's cells left as ground. */
  bare: number;
  /** Share of the backdrop built on; a region paved edge to edge reads 1. */
  spill: number;
  /** Share of the subject that came back water, over the picture's cells only: a water build leaves
   *  the ground around a figure as it was. */
  waterShare: number;
  violations: number;
}

/**
 * Scores a run over the picture's whole footprint: ground is a real answer, and scoring only built
 * cells would reward building less. Ground is bright, so a bright backdrop left alone scores well.
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
 * Pattern times amplitude, each against the range it can move in: the two halves of SSIM that survive
 * a palette change. Pattern alone rates a few correct specks highly; amplitude alone cannot tell
 * picture from noise. Amplitude is relative because a one-cell outline cannot stand eight layers up
 * (V-MTN-03).
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

/** Pearson's r; a flat series (a result of one tier) scores 0. */
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

/** Shannon entropy normalised by `slots`, the palette's size rather than the colours used, so two
 *  colours used evenly score below eight. */
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

/* Legibility, which `fidelity` cannot see: it moves about a tenth across the size range where a
 * picture goes from unmistakable to unreadable. Each measure is a share with one named failure:
 *
 *   presence         the picture's ink that got built on at all; 0 when the backdrop ate the subject
 *   regionSurvival   the source's coherent colour areas that arrived as coherent areas
 *   waterCohesion    the result's water that sits in bodies rather than in specks
 *   hueSeparability  the source's hue-separated, equally-light areas that landed on different colours
 */

/** The fewest cells that make an area rather than a speck, for source colours, tiers and water. */
export const REGION_MIN = 3;

/** The share of a source area that must arrive as one coherent built area for it to survive. */
export const REGION_KEPT = 0.5;

/** Two source areas this close in luma (0 to 255) need hue to tell apart, and count as separated
 *  at this hue gap (degrees). */
export const HUE_LUMA_NEAR = 24;
export const HUE_FAR = 40;
/** The chroma each needs; a grey has no hue. */
export const HUE_CHROMA_MIN = 30;

/** Five bits a channel, so near-identical shades (JPEG noise, a scaler's blend) share an area label. */
const quantise = (rgb: number): number =>
  ((((rgb >> 19) & 0x1f) << 10) | (((rgb >> 11) & 0x1f) << 5) | ((rgb >> 3) & 0x1f)) >>> 0;

/** Hue in degrees and chroma as the channel spread. */
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

/** 4-connected components of cells sharing a label; `label` returns null for a cell not in play. */
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

/** The largest 4-connected run of one built colour inside `cells`. Walks the set, not the grid,
 *  since it runs once per source area. */
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
  /** Share of the picture's ink (`pictureFootprint`) built on. Far below `1 - bare` means the backdrop
   *  pass keyed out ink with the backdrop. */
  presence: number;
  /** Cells of ink `presence` is taken over; 0 means not measurable. */
  footprintCells: number;
  /** Area-weighted share of the source's colour areas that arrived as one built area covering at
   *  least `REGION_KEPT` of themselves. */
  regionSurvival: number;
  /** Areas of `REGION_MIN` cells or more over the subject, in the source and in the result. */
  sourceRegions: number;
  resultRegions: number;
  /** Share of the result's water in bodies of `REGION_MIN` cells or more; 1 with no water, so
   *  condition an average on `waterCells`. */
  waterCohesion: number;
  waterCells: number;
  /** Share of hue-separated, equally light area pairs drawn in different colours; 1 with no pair, so
   *  condition an average on `huePairs`. */
  hueSeparability: number;
  huePairs: number;
}

/** The four legibility measures over one case; `truth` and `footprint` differ by exactly what the
 *  backdrop pass removed. */
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

  // Measured inside the area, so a feature merged into the mass around it does not count as kept.
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

/** Whether areas the source separates only by hue arrive as different colours: on a green ramp they
 *  collapse to one tier, which a luma measure like `fidelity` cannot see. */
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
      // The area's commonest built colour.
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
 * Whether the decoration, the one scarce instrument with a real hue, landed on the source's features
 * as the engine's own `detectFeatures` reads them, rather than over its strongest gradients.
 */
export interface PurposeScore {
  /** Share of marks on a top-feature cell; a scattered pass scores about `featureShare`. */
  onFeature: number;
  /** The same, counting a mark one cell off: a feature is a tier boundary and a flat placement is
   *  refused beside a step, so the pass often stands its mark beside the feature. */
  nearFeature: number;
  /** Share of the top features with a mark on or beside them. */
  featuresSaid: number;
  /** Features the source offers at all, and how many of them the budget could reach. */
  features: number;
  topFeatures: number;
  /** Cells the plan asked for, and marks standing; the gap is what the rules refused. */
  planned: number;
  marks: number;
  /** What a figure this size may carry (`featureBudget`). */
  budget: number;
  /** Share of the figure the top features cover: `onFeature` for random marks. */
  featureShare: number;
  /** Coatings laid (`planBorrow`); they count toward the picture's object load. */
  coatings: number;
}

/**
 * Reads a finished run for decoration purpose. `objects` is what this run laid (the template's plaza
 * can fall inside the box); objects outside the box are dropped, and a coating, which says a region's
 * colour rather than a feature's, is counted apart by its trait.
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
