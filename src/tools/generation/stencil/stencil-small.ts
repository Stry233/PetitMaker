/**
 * Deterministic image-reading adjustments for small stencil regions.
 * The short side controls a smooth 24-to-32-cell gate; weight zero leaves the standard path untouched.
 * Small regions preserve a few coherent areas and translate useful hue differences into a one-hue terrain ramp.
 */
import type { Stencil } from '../../../core/model/types';
import { covered, luma, type ToneRange } from './stencil';

/** Full treatment through 24 cells on the short side, fading linearly to zero at 32. */
export const SMALL_BOX_FULL = 24;
export const SMALL_BOX_OFF = 32;

/** How much of the small-box treatment a box of this shape gets: 1 at or below `SMALL_BOX_FULL`, 0 at
 *  or above `SMALL_BOX_OFF`, straight between. */
export function smallBoxWeight(box: { width: number; height: number }): number {
  const side = Math.min(box.width, box.height);
  if (side <= SMALL_BOX_FULL) return 1;
  if (side >= SMALL_BOX_OFF) return 0;
  return (SMALL_BOX_OFF - side) / (SMALL_BOX_OFF - SMALL_BOX_FULL);
}

/** Share of a one-hue palette's tonal range reserved for hue separation at full weight. */
export const HUE_RANGE_SHARE = 0.5;

/** The most tone a hue difference may claim, either side of where the picture's own tone landed. */
export function hueReach(weight: number, palette: ToneRange): number {
  return weight <= 0 ? 0 : (HUE_RANGE_SHARE * weight * (palette.hi - palette.lo)) / 2;
}

/** Chroma bounds for applying hue offsets; neutral colors retain their tone. */
export const HUE_CHROMA_FULL = 60;
export const HUE_CHROMA_MIN = 16;

/** Minimum weighted mass outside the dominant hue family before hue consumes tonal range. */
export const HUE_FAMILY_MIN = 1 / 12;

/** Thirty-degree sectors used to identify the dominant hue family. */
const HUE_SECTORS = 12;

/** Hue in degrees and chroma as the channel spread — enough of HSV for "is this a different colour,
 *  or the same colour darker". */
export function hueOf(rgb: number): { hue: number; chroma: number } {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c === 0) return { hue: 0, chroma: 0 };
  const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return { hue: ((h * 60) % 360 + 360) % 360, chroma: c };
}

/** The turn from `from` to `to`, signed, in (-180, 180]. */
export function signedTurn(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Compressive signed hue distance in [-1, 1], giving nearby color families useful separation. */
export function hueLift(turn: number): number {
  const share = Math.min(1, Math.abs(turn) / 180);
  return Math.sign(turn) * Math.sqrt(share);
}

/**
 * Maps hue distance from the dominant family into bounded tonal offsets.
 * The hue-circle cut falls opposite the dominant family, and chroma weights each offset; null means hue adds no useful distinction.
 */
export function hueToneOffsets(
  stencil: Stencil,
  matchable: (index: number) => boolean,
  reach: number,
): Float32Array | null {
  if (reach <= 0) return null;
  const { width, height } = stencil;
  const n = width * height;
  const sectors = new Float64Array(HUE_SECTORS);
  const sectorX = new Float64Array(HUE_SECTORS), sectorY = new Float64Array(HUE_SECTORS);
  const hue = new Float32Array(n), pull = new Float32Array(n);
  let coloured = 0;
  for (let i = 0; i < n; i++) {
    if (!matchable(i)) continue;
    const { hue: h, chroma } = hueOf(stencil.color[i] ?? 0);
    if (chroma < HUE_CHROMA_MIN) continue;
    const share = Math.min(1, chroma / HUE_CHROMA_FULL);
    hue[i] = h;
    pull[i] = share;
    const sector = Math.min(HUE_SECTORS - 1, Math.floor((h / 360) * HUE_SECTORS));
    sectors[sector] = sectors[sector]! + share;
    sectorX[sector] = sectorX[sector]! + share * Math.cos((h * Math.PI) / 180);
    sectorY[sector] = sectorY[sector]! + share * Math.sin((h * Math.PI) / 180);
    coloured++;
  }
  if (coloured === 0) return null;
  // Use the weighted mean within the strongest family; lower-index sectors win ties.
  let best = 0;
  for (let s = 1; s < HUE_SECTORS; s++) if (sectors[s]! > sectors[best]!) best = s;
  const dominant = ((Math.atan2(sectorY[best]!, sectorX[best]!) * 180) / Math.PI + 360) % 360;

  // Adjacent sectors belong to the dominant family; only farther sectors justify an offset.
  let total = 0, elsewhere = 0;
  for (let s = 0; s < HUE_SECTORS; s++) {
    total += sectors[s]!;
    const away = Math.min(Math.abs(s - best), HUE_SECTORS - Math.abs(s - best));
    if (away > 1) elsewhere += sectors[s]!;
  }
  if (total <= 0 || elsewhere / total < HUE_FAMILY_MIN) return null;

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (pull[i] === 0) continue;
    out[i] = hueLift(signedTurn(dominant, hue[i]!)) * reach * pull[i]!;
  }
  return out;
}

/** Minimum coherent water body and its one-palette-step growth tolerance. */
export const WATER_BODY_MIN = 3;
export const WATER_GROW_STEPS = 1;

/**
 * Grows undersized water bodies from eligible bright neighbours or returns them to land.
 * Mutates `isWater`, processes larger bodies first, breaks ties by cell index, and returns the number of changed cells.
 */
export function settleWaterBodies(
  stencil: Stencil,
  isWater: Uint8Array,
  weight: number,
  tone: (index: number) => number | null,
  cut: number,
  step: number,
  open: (index: number) => boolean,
): number {
  if (weight <= 0) return 0;
  const { width, height } = stencil;
  const n = width * height;
  const floor = Number.isFinite(cut) ? cut - WATER_GROW_STEPS * step : cut;
  let moved = 0;

  const bodies = (): number[][] => {
    const seen = new Uint8Array(n);
    const out: number[][] = [];
    for (let start = 0; start < n; start++) {
      if (seen[start] || !isWater[start]) continue;
      const body = [start];
      seen[start] = 1;
      const stack = [start];
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % width, y = (i / width) | 0;
        for (const [dx, dy] of EDGES) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || !isWater[next]) continue;
          seen[next] = 1;
          body.push(next);
          stack.push(next);
        }
      }
      out.push(body);
    }
    return out;
  };

  for (const body of bodies().sort((a, b) => (b.length - a.length) || (a[0]! - b[0]!))) {
    if (body.length >= WATER_BODY_MIN) continue;
    if (body.some((i) => !isWater[i])) continue;             // already grown into by a larger body
    // The lightest cells beside it that the picture would let be water, brightest first.
    const beside = new Map<number, number>();
    for (const i of body) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of EDGES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (isWater[next] || beside.has(next) || !open(next)) continue;
        const own = tone(next);
        if (own === null || own < floor) continue;
        beside.set(next, own);
      }
    }
    const grow = [...beside.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
    if (body.length + grow.length < WATER_BODY_MIN) {
      for (const i of body) { isWater[i] = 0; moved++; }
      continue;
    }
    for (const [i] of grow.slice(0, WATER_BODY_MIN - body.length)) { isWater[i] = 1; moved++; }
  }
  return moved;
}

/** Per-channel interpolation; weights zero and one return the endpoints exactly. */
export function blendColour(from: number, to: number, weight: number): number {
  if (weight <= 0) return from;
  if (weight >= 1) return to;
  const mix = (shift: number): number => {
    const a = (from >> shift) & 0xff, b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * weight);
  };
  return ((mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
}

/** Share of a flat region's palette request supplied by its region-level color. */
export const AREA_SHARE = 1;

/** Region-level thresholds, in palette steps, that distinguish flat areas from smooth gradients. */
export const REGION_RANGE_MIN = 2;
export const REGION_SMOOTH_MAX = 0.7;
export const REGION_ROUGH_MIN = 1.4;

export function regionFlatness(
  stencil: Stencil, areas: readonly Area[], colourAt: (index: number) => number, step: number,
): number[] {
  if (!(step > 0)) return areas.map(() => 1);
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  return areas.map((area, id) => {
    const tones = area.cells.map((i) => luma(colourAt(i))).sort((a, b) => a - b);
    const range = (tones[Math.floor(tones.length * 0.9)]! - tones[Math.floor(tones.length * 0.1)]!) / step;
    if (range < REGION_RANGE_MIN) return 1;
    let pairs = 0, sum = 0;
    for (const i of area.cells) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (owner[next] !== id) continue;
        pairs++;
        sum += Math.abs(luma(colourAt(i)) - luma(colourAt(next)));
      }
    }
    if (pairs === 0) return 1;
    const rough = sum / pairs / step;
    return Math.min(1, Math.max(0, (rough - REGION_SMOOTH_MAX) / (REGION_ROUGH_MIN - REGION_SMOOTH_MAX)));
  });
}

export function readSmallBox(
  stencil: Stencil,
  matchable: (index: number) => boolean,
  colourAt: (index: number) => number,
  weight: number,
  entries: readonly { rgb: number }[],
  distinct: boolean,
  damping: number,
  minTone?: (depth: number) => number,
): SmallBoxRead | null {
  if (weight <= 0 || entries.length === 0) return null;
  // Flatness is measured per region so shaded subjects retain gradients while flat areas stay coherent.
  const read0 = coherentAreas(stencil, matchable, colourAt);
  if (read0.length === 0) return null;
  // A one-hue ramp spends distinct entries on a bounded set of spatial regions.
  const outline = distinct ? fuseAreas(read0, figureRim(stencil, read0)) : { areas: read0, at: -1 };
  const grouped = distinct
    ? mergeToTarget(stencil, outline.areas, regionTarget(stencil, outline.areas, weight), outline.at)
    : { areas: read0, protect: -1 };
  const areas = grouped.areas;
  const rim = grouped.protect;
  const target = new Uint32Array(stencil.width * stencil.height);
  const has = new Uint8Array(stencil.width * stencil.height);
  let slots: number[] | null = null;
  if (distinct) {
    const read = areaSalience(stencil, areas);
    slots = allocateEntries(
      areas, read, entries.map((entry) => luma(entry.rgb)),
      minTone ? read.depth.map(minTone) : [], rim,
    );
  }
  const tones = entries.map((entry) => luma(entry.rgb)).sort((a, b) => a - b);
  const step = entries.length > 1 ? (tones[tones.length - 1]! - tones[0]!) / (entries.length - 1) : 0;
  const flat = regionFlatness(stencil, areas, colourAt, step);
  const told = new Float32Array(stencil.width * stencil.height);
  for (const [id, area] of areas.entries()) {
    const want = slots ? entries[slots[id]!]!.rgb : area.rgb;
    for (const i of area.cells) { target[i] = want; has[i] = 1; told[i] = flat[id]!; }
  }
  const share = weight * AREA_SHARE;
  const mean = areas.reduce((sum, area, id) => sum + flat[id]! * area.cells.length, 0)
    / Math.max(1, areas.reduce((sum, area) => sum + area.cells.length, 0));
  return {
    regions: areas,
    rim,
    wanted: (i) => {
      if (!matchable(i)) return null;
      const own = colourAt(i);
      return has[i] ? blendColour(own, target[i]!, share * told[i]!) : own;
    },
    // Dither remains only where the gate and region gradients leave per-cell tone to express.
    damping: damping * (1 - share * mean),
  };
}

/** Region-aware palette requests and residual dither for a small stencil. */
export interface SmallBoxRead {
  wanted: (index: number) => number | null;
  damping: number;
  /** The regions the picture was read as, in ascending first-cell order. */
  regions: Area[];
  /** The enclosing rim region's index, or -1 where the picture has no such region. */
  rim: number;
}

/** Target three to six spatial regions, roughly one for every four cells on the short side. */
export const REGION_TARGET_MIN = 3;
export const REGION_TARGET_MAX = 6;
export const REGION_CELLS_PER = 4;

export function regionTarget(box: { width: number; height: number }, areas: readonly Area[], weight: number): number {
  const side = Math.min(box.width, box.height);
  const base = Math.min(REGION_TARGET_MAX, Math.max(REGION_TARGET_MIN, Math.round(side / REGION_CELLS_PER)));
  const held = Math.max(base, areas.length);
  return Math.round(base + (1 - Math.min(1, Math.max(0, weight))) * (held - base));
}

/**
 * Merges adjacent areas to `target` using color distance weighted by harmonic mean area size.
 * `protect` identifies an unmergeable outline; pair scan order provides deterministic ties.
 */
export function mergeToTarget(
  stencil: Stencil, areas: readonly Area[], target: number, protect = -1,
): { areas: Area[]; protect: number } {
  const n = areas.length;
  if (n <= Math.max(1, target)) return { areas: [...areas], protect };
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  const near: Set<number>[] = areas.map(() => new Set<number>());
  for (let i = 0; i < width * height; i++) {
    const own = owner[i]!;
    if (own < 0) continue;
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = owner[ny * width + nx]!;
      if (other < 0 || other === own) continue;
      near[own]!.add(other);
      near[other]!.add(own);
    }
  }
  const cells = areas.map((area) => [...area.cells]);
  const sums = areas.map((area) => ({
    r: ((area.rgb >> 16) & 0xff) * area.cells.length,
    g: ((area.rgb >> 8) & 0xff) * area.cells.length,
    b: (area.rgb & 0xff) * area.cells.length,
  }));
  const alive = areas.map(() => true);
  const meanOf = (id: number): number => {
    const size = Math.max(1, cells[id]!.length), s = sums[id]!;
    return ((Math.round(s.r / size) << 16) | (Math.round(s.g / size) << 8) | Math.round(s.b / size)) >>> 0;
  };

  let count = n;
  while (count > target) {
    let from = -1, into = -1, best = Infinity;
    for (let a = 0; a < n; a++) {
      if (!alive[a] || a === protect) continue;
      for (const b of near[a]!) {
        if (b <= a || !alive[b] || b === protect) continue;
        const sa = cells[a]!.length, sb = cells[b]!.length;
        const cost = Math.sqrt(colourDistance(meanOf(a), meanOf(b))) * ((sa * sb) / (sa + sb));
        if (cost < best) { best = cost; into = a; from = b; }
      }
    }
    if (from < 0 || into < 0) break;   // every pair left touches the protected region: nothing to do
    for (const i of cells[from]!) { owner[i] = into; cells[into]!.push(i); }
    sums[into]!.r += sums[from]!.r; sums[into]!.g += sums[from]!.g; sums[into]!.b += sums[from]!.b;
    cells[into]!.sort((a, b) => a - b);
    cells[from]!.length = 0;
    alive[from] = false;
    for (const b of near[from]!) { if (b !== into) { near[into]!.add(b); near[b]!.add(into); } near[b]!.delete(from); }
    count--;
  }

  const kept = areas.map((_, id) => id).filter((id) => alive[id] && cells[id]!.length > 0);
  const out = kept.map((id) => {
    const rgb = meanOf(id);
    return { cells: cells[id]!, rgb, tone: luma(rgb) };
  });
  const order = kept.map((id, at) => ({ id, at })).sort((a, b) => out[a.at]!.cells[0]! - out[b.at]!.cells[0]!);
  return {
    areas: order.map((o) => out[o.at]!),
    protect: order.findIndex((o) => o.id === protect),
  };
}

/** Detects dark, shallow regions that collectively enclose enough of the figure to form an outline. */
export const RIM_ENCLOSE_MIN = 0.4;
export const RIM_DEPTH_MAX = 2;
export const RIM_SHARE_MAX = 0.4;
/** How much of the figure an outline may be and still be given its own tier rather than kept in the
 *  picture's order (`allocateEntries`, where the arithmetic behind the fifth is). */
export const RIM_SPEND_MAX = 0.2;

export function figureRim(stencil: Stencil, areas: readonly Area[]): number[] {
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  let figure = 0;
  for (const [id, area] of areas.entries()) {
    for (const i of area.cells) owner[i] = id;
    figure += area.cells.length;
  }
  if (figure === 0) return [];
  const depth = cellDepths(stencil, (i) => owner[i]! >= 0);
  let boundary = 0;
  for (let i = 0; i < width * height; i++) if (owner[i]! >= 0 && depth[i] === 1) boundary++;
  if (boundary === 0) return [];
  const mean = areas.reduce((sum, area) => sum + area.tone * area.cells.length, 0) / figure;

  const out: number[] = [];
  let cells = 0, edge = 0;
  for (const [id, area] of areas.entries()) {
    if (area.tone >= mean) continue;
    if (area.cells.reduce((sum, i) => sum + depth[i]!, 0) / area.cells.length > RIM_DEPTH_MAX) continue;
    out.push(id);
    cells += area.cells.length;
    edge += area.cells.filter((i) => depth[i] === 1).length;
  }
  if (out.length === 0) return [];
  if (edge / boundary < RIM_ENCLOSE_MIN || cells > figure * RIM_SHARE_MAX) return [];
  return out;
}

/** Fuses selected areas by cell-weighted mean color and returns the fused area's sorted position. */
export function fuseAreas(areas: readonly Area[], ids: readonly number[]): { areas: Area[]; at: number } {
  const taken = new Set(ids);
  if (taken.size === 0) return { areas: [...areas], at: -1 };
  // Preserve object identity when the selected outline is already one connected area.
  if (taken.size === 1) return { areas: [...areas], at: ids[0]! };
  const cells: number[] = [];
  let r = 0, g = 0, b = 0;
  for (const id of taken) {
    const area = areas[id];
    if (!area) continue;
    cells.push(...area.cells);
    r += ((area.rgb >> 16) & 0xff) * area.cells.length;
    g += ((area.rgb >> 8) & 0xff) * area.cells.length;
    b += (area.rgb & 0xff) * area.cells.length;
  }
  if (cells.length === 0) return { areas: [...areas], at: -1 };
  cells.sort((a, b2) => a - b2);
  const rgb = ((Math.round(r / cells.length) << 16) | (Math.round(g / cells.length) << 8) | Math.round(b / cells.length)) >>> 0;
  const fused: Area = { cells, rgb, tone: luma(rgb) };
  const out = [...areas.filter((_, id) => !taken.has(id)), fused]
    .sort((a, b2) => a.cells[0]! - b2.cells[0]!);
  return { areas: out, at: out.indexOf(fused) };
}

/** A four-connected run in five-bit-per-channel color space. */
export interface Area {
  /** Cell indices, in ascending order. */
  cells: number[];
  /** Cell-weighted mean source color. */
  rgb: number;
  /** Luma of `rgb`. */
  tone: number;
}

/** Minimum cell count for a coherent area. */
export const AREA_MIN = 3;

/** Maximum channel-weighted distance for folding a speck into an adjacent area. */
export const FOLD_MAX = 30;

const bucketOf = (rgb: number): number =>
  ((((rgb >> 19) & 0x1f) << 10) | (((rgb >> 11) & 0x1f) << 5) | ((rgb >> 3) & 0x1f)) >>> 0;

/** Channel-weighted Euclidean color distance used by all thresholds in this module. */
export function colourGap(a: number, b: number): number {
  return Math.sqrt(colourDistance(a, b));
}

const colourDistance = (a: number, b: number): number => {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
};

/** Segments writable cells by their fitted color and folds close undersized regions into neighbours. */
export function coherentAreas(
  stencil: Stencil,
  matchable: (index: number) => boolean,
  colourAt: (index: number) => number,
): Area[] {
  const { width, height } = stencil;
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const areas: { cells: number[]; r: number; g: number; b: number }[] = [];
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1 || !matchable(start) || !covered(stencil, start % width, (start / width) | 0)) continue;
    const bucket = bucketOf(colourAt(start));
    const id = areas.length;
    const area = { cells: [start], r: 0, g: 0, b: 0 };
    areas.push(area);
    label[start] = id;
    const stack = [start];
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of EDGES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (label[next] !== -1 || !matchable(next) || !covered(stencil, nx, ny)) continue;
        if (bucketOf(colourAt(next)) !== bucket) continue;
        label[next] = id;
        area.cells.push(next);
        stack.push(next);
      }
    }
  }
  for (const area of areas) {
    area.cells.sort((a, b) => a - b);
    for (const i of area.cells) {
      const rgb = colourAt(i);
      area.r += (rgb >> 16) & 0xff; area.g += (rgb >> 8) & 0xff; area.b += rgb & 0xff;
    }
  }
  const mean = (a: { cells: number[]; r: number; g: number; b: number }): number => {
    const size = a.cells.length;
    return ((Math.round(a.r / size) << 16) | (Math.round(a.g / size) << 8) | Math.round(a.b / size)) >>> 0;
  };

  // Resolve larger specks first; keep isolated or strongly contrasting details such as outlines.
  const order = areas.map((_, id) => id)
    .filter((id) => areas[id]!.cells.length < AREA_MIN)
    .sort((a, b) => (areas[b]!.cells.length - areas[a]!.cells.length) || (areas[a]!.cells[0]! - areas[b]!.cells[0]!));
  for (const id of order) {
    const area = areas[id]!;
    if (area.cells.length === 0 || area.cells.length >= AREA_MIN) continue;
    const own = mean(area);
    let host = -1, bestD = Infinity;
    for (const i of area.cells) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of EDGES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const other = label[ny * width + nx]!;
        if (other < 0 || other === id || areas[other]!.cells.length === 0) continue;
        const d = colourDistance(own, mean(areas[other]!));
        if (d < bestD || (d === bestD && (host < 0 || areas[other]!.cells[0]! < areas[host]!.cells[0]!))) {
          bestD = d; host = other;
        }
      }
    }
    if (host < 0 || bestD > FOLD_MAX * FOLD_MAX) continue;
    const into = areas[host]!;
    for (const i of area.cells) { label[i] = host; into.cells.push(i); }
    into.r += area.r; into.g += area.g; into.b += area.b;
    into.cells.sort((a, b) => a - b);
    area.cells = [];
  }

  return areas
    .filter((a) => a.cells.length > 0)
    .map((a) => ({ cells: a.cells, rgb: mean(a), tone: luma(mean(a)) }))
    .sort((a, b) => a.cells[0]! - b.cells[0]!);
}

const EDGES: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** The first entry, in tone order, at least this light — 0 where nothing is asked. */
function indexAtLeast(byTone: readonly { tone: number }[], tone: number | undefined): number {
  if (tone === undefined || !Number.isFinite(tone)) return 0;
  for (const [index, entry] of byTone.entries()) if (entry.tone >= tone) return index;
  return byTone.length - 1;
}

/** Four-connected distance from each figure cell to the outside: 1 on the rim, increasing inward. */
export function cellDepths(
  stencil: Stencil,
  inFigure: (index: number) => boolean,
): Int32Array {
  const { width, height } = stencil;
  const depth = new Int32Array(width * height);
  const queue: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (!inFigure(i)) continue;
    const x = i % width, y = (i / width) | 0;
    let rim = false;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !inFigure(ny * width + nx)) { rim = true; break; }
    }
    if (rim) { depth[i] = 1; queue.push(i); }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!inFigure(next) || depth[next] !== 0) continue;
      depth[next] = depth[i]! + 1;
      queue.push(next);
    }
  }
  return depth;
}

/** Scores each area by normalized size × neighbour contrast × interior depth. */
export function areaSalience(stencil: Stencil, areas: readonly Area[]): AreaReading {
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  const depth = cellDepths(stencil, (i) => owner[i]! >= 0);

  const size: number[] = [], contrast: number[] = [], inside: number[] = [], deepest: number[] = [];
  const touches: number[][] = [];
  for (const [id, area] of areas.entries()) {
    let worst = 0;
    const near = new Set<number>();
    for (const i of area.cells) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of EDGES) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const other = owner[ny * width + nx]!;
        if (other < 0 || other === id) continue;
        near.add(other);
        const d = Math.sqrt(colourDistance(area.rgb, areas[other]!.rgb));
        if (d > worst) worst = d;
      }
    }
    size.push(area.cells.length);
    contrast.push(worst);
    inside.push(area.cells.reduce((sum, i) => sum + depth[i]!, 0) / area.cells.length);
    // A region's shallowest cell caps the uniform tier that all of its cells can support.
    deepest.push(area.cells.reduce((least, i) => Math.min(least, depth[i]!), Infinity));
    touches.push([...near].sort((a, b) => a - b));
  }
  const share = (xs: number[]): number[] => {
    const top = Math.max(...xs, 0);
    // A missing comparison is neutral rather than zero salience.
    return top <= 0 ? xs.map(() => 1) : xs.map((v) => v / top);
  };
  const [s, c, d] = [share(size), share(contrast), share(inside)];
  return { salience: areas.map((_, id) => s[id]! * c[id]! * d[id]!), depth: deepest, touches };
}

/** Salience, minimum support depth, and adjacency for each area. */
export interface AreaReading { salience: number[]; depth: number[]; touches: number[][] }

/**
 * Assigns one palette entry to each connected image area. Areas begin at their nearest tone; close
 * groups merge before scarce entries are assigned, and salient collisions receive unused adjacent
 * entries while preserving tonal order. Support depth caps each area's tier. A sufficiently thin
 * silhouette may use its darkest legal tier independently so the enclosed mass keeps its range.
 */
export function allocateEntries(
  areas: readonly Area[],
  read: AreaReading,
  entryTones: readonly number[],
  minTone: readonly number[] = [],
  rim = -1,
): number[] {
  const { salience } = read;
  const out = new Array<number>(areas.length).fill(0);
  if (areas.length === 0 || entryTones.length === 0) return out;
  const byTone = entryTones.map((tone, index) => ({ tone, index })).sort((a, b) => a.tone - b.tone);

  // Merge groups whose complete tonal range is narrower than one palette step. Using complete ranges
  // avoids the single-linkage effect that would collapse a gradual gradient into one group.
  const step = byTone.length > 1
    ? (byTone[byTone.length - 1]!.tone - byTone[0]!.tone) / (byTone.length - 1)
    : Infinity;

  let groups = areas.map((area, id) => ({
    ids: [id], tone: area.tone, lo: area.tone, hi: area.tone,
    cells: area.cells.length, salience: salience[id] ?? 0,
    floor: indexAtLeast(byTone, minTone[id]),
  })).sort((a, b) => (a.tone - b.tone) || (areas[a.ids[0]!]!.cells[0]! - areas[b.ids[0]!]!.cells[0]!));

  // A detected outline remains one palette group.
  const holdsRim = (group: { ids: number[] }): boolean => rim >= 0 && group.ids.includes(rim);
  // Thin outlines may receive an independent entry.
  const rimShare = rim >= 0
    ? (areas[rim]?.cells.length ?? 0) / Math.max(1, areas.reduce((sum, area) => sum + area.cells.length, 0))
    : 1;
  const apart = rim >= 0 && rimShare <= RIM_SPEND_MAX;
  const joinable = (i: number): boolean => !holdsRim(groups[i]!) && !holdsRim(groups[i + 1]!);
  const nearest = (): { at: number; span: number } => {
    let at = -1, span = Infinity;
    for (let i = 0; i + 1 < groups.length; i++) {
      const a = groups[i]!, b = groups[i + 1]!;
      if (!joinable(i)) continue;
      const own = Math.max(a.hi, b.hi) - Math.min(a.lo, b.lo);
      if (own < span) { span = own; at = i; }
    }
    return { at, span };
  };
  const cheapest = (): number => {
    let at = -1, best = Infinity;
    for (let i = 0; i + 1 < groups.length; i++) {
      if (!joinable(i)) continue;
      const cost = (groups[i + 1]!.tone - groups[i]!.tone) * Math.min(groups[i]!.salience, groups[i + 1]!.salience);
      if (cost < best) { best = cost; at = i; }
    }
    return at;
  };
  while (groups.length > 1) {
    const near = nearest();
    const at = near.at >= 0 && near.span < step ? near.at
      : groups.length > byTone.length ? cheapest()
        : -1;
    if (at < 0) break;
    const a = groups[at]!, b = groups[at + 1]!;
    const cells = a.cells + b.cells;
    groups.splice(at, 2, {
      ids: [...a.ids, ...b.ids],
      tone: (a.tone * a.cells + b.tone * b.cells) / cells,
      lo: Math.min(a.lo, b.lo),
      hi: Math.max(a.hi, b.hi),
      cells,
      salience: Math.max(a.salience, b.salience),
      floor: Math.max(a.floor, b.floor),
    });
  }

  // One area has no inter-area order to preserve.
  const single = groups.length === 1;

  // Start each group at its nearest tone.
  const want = groups.map((group) => {
    let at = 0, bestD = Infinity;
    for (const [index, entry] of byTone.entries()) {
      const d = Math.abs(entry.tone - group.tone);
      if (d < bestD) { bestD = d; at = index; }
    }
    return at;
  });

  // Shift ordered groups together to satisfy support floors; handle a thin outline independently.
  const spent = apart ? groups.map((_, k) => k).filter((k) => !holdsRim(groups[k]!)) : [];
  const carried = spent.length > 0 ? spent : groups.map((_, k) => k);
  const first = carried[0]!, last = carried[carried.length - 1]!;
  const shift = single ? 0 : carried.reduce((most, k) => Math.max(most, groups[k]!.floor - want[k]!), 0);
  const base = Math.min(byTone.length - 1, want[first]! + shift);
  const span = Math.max(1, want[last]! - want[first]!);
  let previous = -1;
  for (const [seat, k] of carried.entries()) {
    const group = groups[k]!;
    const room = byTone.length - 1 - base;
    const spread = base + ((want[k]! - want[first]!) / span) * room;
    // Room for the groups still to come, so the last one is never pushed off the end of the palette.
    const ceiling = byTone.length - 1 - (carried.length - 1 - seat);
    const at = Math.min(byTone.length - 1, Math.max(Math.min(ceiling, Math.max(Math.round(spread), previous + 1)), single ? 0 : group.floor));
    previous = at;
    for (const id of group.ids) out[id] = byTone[at]!.index;
  }
  // Give an independent outline its darkest supported tier.
  for (const [k, group] of groups.entries()) {
    if (!holdsRim(group) || carried.includes(k)) continue;
    for (const id of group.ids) out[id] = byTone[group.floor]!.index;
  }
  return out;
}


/** Whether another material family may represent none, a bounded accent, or any region. */
export type BorrowPolicy = 'none' | 'accent' | 'free';

/** Accent area cap and minimum channel-weighted improvement over the primary palette. */
export const BORROW_ACCENT_SHARE = 1 / 3;
export const BORROW_MIN_GAIN = 24;
/** Minimum fraction of a region that must accept the borrowed material. */
export const BORROW_COVER_MIN = 0.4;

/** The nearest entry of a palette to a colour, and how far off it is (channel-weighted, not squared). */
export function nearestEntry(
  entries: readonly { rgb: number }[], rgb: number,
): { at: number; off: number } {
  let at = -1, best = Infinity;
  for (const [index, entry] of entries.entries()) {
    const d = colourDistance(entry.rgb, rgb);
    if (d < best) { best = d; at = index; }
  }
  return { at, off: at < 0 ? Infinity : Math.sqrt(best) };
}

/**
 * Assigns eligible regions to a closer coating palette under the borrow policy.
 * The outline stays in the primary material; offers rank by color gain × area with stable cell-order ties.
 */
export function planBorrow(
  regions: readonly Area[],
  rim: number,
  own: (area: Area) => number,
  ramp: readonly { rgb: number }[],
  coatings: readonly { catalogId: string; rgb: number }[],
  policy: BorrowPolicy,
): Map<number, string> {
  const out = new Map<number, string>();
  if (policy === 'none' || coatings.length === 0 || ramp.length === 0) return out;
  const figure = regions.reduce((sum, area) => sum + area.cells.length, 0);
  if (figure === 0) return out;

  const offers: { id: number; gain: number; at: number }[] = [];
  for (const [id, area] of regions.entries()) {
    if (id === rim || area.cells.length < AREA_MIN) continue;
    const rgb = own(area);
    const mine = nearestEntry(ramp, rgb), theirs = nearestEntry(coatings, rgb);
    const gain = mine.off - theirs.off;
    if (gain < BORROW_MIN_GAIN || theirs.at < 0) continue;
    offers.push({ id, gain, at: theirs.at });
  }
  offers.sort((a, b) => (b.gain * regions[b.id]!.cells.length - a.gain * regions[a.id]!.cells.length)
    || (regions[a.id]!.cells[0]! - regions[b.id]!.cells[0]!));

  const cap = policy === 'free' ? figure : figure * BORROW_ACCENT_SHARE;
  let spent = 0;
  for (const offer of offers) {
    const cells = regions[offer.id]!.cells.length;
    if (spent + cells > cap) continue;
    spent += cells;
    out.set(offer.id, coatings[offer.at]!.catalogId);
  }
  return out;
}

/** Hue tolerance, minimum patch size, total area budget, and region cap for color beds. */
export const FILL_HUE_MAX = 40;
export const FILL_BED_MIN = 2;
export const FILL_BUDGET_SHARE = 1 / 16;
export const FILL_MAX_REGIONS = 2;

/** One body filled: which region, the coating that says its colour, and how many cells the bed may take. */
export interface ColourFill { region: number; catalogId: string; want: number }

/** Map-dependent availability and borrow budget supplied by the caller. */
export interface FillGate {
  bodyShare: number;
  paved: ReadonlySet<number>;
  ground: (region: number) => number;
  /** Shared policy for region paving and color beds. */
  policy: BorrowPolicy;
  /** Cells the paving already laid, charged against what an accent material may spend. */
  coated: number;
}

/**
 * Plans small beds of borrowed colour for large bodies that cannot accept enough paving. A bed is
 * offered only when a same-hue coating improves materially on the terrain ramp, shares the ordinary
 * borrow policy and remaining accent budget, and has enough valid ground. Offers rank by gain times
 * area; the bounded budget is divided evenly, with stable first-cell tie-breaking.
 */
export function planColourFill(
  regions: readonly Area[],
  rim: number,
  own: (area: Area) => number,
  ramp: readonly { rgb: number }[],
  coatings: readonly { catalogId: string; rgb: number }[],
  gate: FillGate,
): ColourFill[] {
  if (coatings.length === 0 || ramp.length === 0 || gate.policy === 'none') return [];
  const figure = regions.reduce((sum, area) => sum + area.cells.length, 0);
  // Accent beds share their budget with region paving; free borrowing has no shared cap.
  const room = gate.policy === 'free' ? Infinity
    : Math.floor(figure * BORROW_ACCENT_SHARE) - gate.coated;
  const budget = Math.min(room, Math.round(figure * FILL_BUDGET_SHARE));
  if (figure === 0 || budget < FILL_BED_MIN) return [];

  const offers: { id: number; gain: number; at: number; ground: number }[] = [];
  for (const [id, area] of regions.entries()) {
    if (id === rim || gate.paved.has(id)) continue;
    if (area.cells.length <= figure * gate.bodyShare) continue;   // a feature, and the accent's business
    const rgb = own(area);
    if (hueOf(rgb).chroma < HUE_CHROMA_MIN) continue;             // a grey has no hue for a bed to say
    const mine = nearestEntry(ramp, rgb);
    const theirs = hueMatched(coatings, rgb, FILL_HUE_MAX);
    if (theirs === null || mine.off - theirs.off < BORROW_MIN_GAIN) continue;
    const ground = gate.ground(id);
    if (ground < FILL_BED_MIN) continue;                          // no ground will hold a bed here
    offers.push({ id, gain: mine.off - theirs.off, at: theirs.at, ground });
  }
  offers.sort((a, b) => (b.gain * regions[b.id]!.cells.length - a.gain * regions[a.id]!.cells.length)
    || (regions[a.id]!.cells[0]! - regions[b.id]!.cells[0]!));

  const taken = offers.slice(0, FILL_MAX_REGIONS);
  if (taken.length === 0) return [];
  const share = Math.max(FILL_BED_MIN, Math.floor(budget / taken.length));
  let left = budget;
  const want = taken.map((offer) => {
    const take = Math.min(share, offer.ground, left);
    left -= take;
    return take;
  });
  for (const [at, offer] of taken.entries()) {
    if (left <= 0) break;
    const more = Math.min(left, offer.ground - want[at]!);
    want[at] = want[at]! + more;
    left -= more;
  }
  return taken
    .map((offer, at) => ({ region: offer.id, catalogId: coatings[offer.at]!.catalogId, want: want[at]! }))
    .filter((fill) => fill.want >= FILL_BED_MIN);
}

/** Finds the nearest chromatic palette entry within `maxTurn` degrees of the source hue. */
export function hueMatched(
  entries: readonly { rgb: number }[], rgb: number, maxTurn: number,
): { at: number; off: number } | null {
  const own = hueOf(rgb);
  let at = -1, best = Infinity;
  for (const [index, entry] of entries.entries()) {
    const theirs = hueOf(entry.rgb);
    if (theirs.chroma < HUE_CHROMA_MIN) continue;
    if (Math.abs(signedTurn(own.hue, theirs.hue)) > maxTurn) continue;
    const d = colourDistance(entry.rgb, rgb);
    if (d < best) { best = d; at = index; }
  }
  return at < 0 ? null : { at, off: Math.sqrt(best) };
}

/**
 * Selects one connected color bed by breadth-first search from the deepest eligible cell.
 * Lowest cell index and fixed neighbour order make the result deterministic.
 */
export function bedCells(
  stencil: Stencil, area: Area, open: (index: number) => boolean, want: number,
): number[] {
  if (want <= 0) return [];
  const { width, height } = stencil;
  const mine = new Set(area.cells);
  const depth = cellDepths(stencil, (i) => mine.has(i));
  let seed = -1, deepest = -1;
  for (const i of area.cells) {
    if (!open(i)) continue;
    if (depth[i]! > deepest) { deepest = depth[i]!; seed = i; }
  }
  if (seed < 0) return [];

  const out: number[] = [];
  const seen = new Set<number>([seed]);
  const queue = [seed];
  for (let head = 0; head < queue.length && out.length < want; head++) {
    const i = queue[head]!;
    if (open(i)) out.push(i);
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!mine.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return out;
}

/** Mean source color over a region before palette fitting. */
export function sourceColour(stencil: Stencil, area: Area): number {
  let r = 0, g = 0, b = 0;
  for (const i of area.cells) {
    const rgb = stencil.color[i] ?? 0;
    r += (rgb >> 16) & 0xff; g += (rgb >> 8) & 0xff; b += rgb & 0xff;
  }
  const n = Math.max(1, area.cells.length);
  return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
}

/** Minimum channel-weighted source-color gap for treating a shared palette entry as a collision. */
export const COLLIDE_MIN = 12;
