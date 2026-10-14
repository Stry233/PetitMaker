/**
 * Deterministic image-reading adjustments for small stencil regions.
 * The short side controls a smooth 24-to-32-cell gate; weight zero leaves the standard path untouched.
 * Small regions preserve a few coherent areas and translate useful hue differences into a one-hue terrain ramp.
 */
import type { Stencil } from '../recipe';
import type { ToneRange } from './stencil';
import { HUE_CHROMA_MIN, blendColor, hueMatched, hueOf, luma, nearestEntry, signedTurn } from './color';
import {
  AREA_MIN, allocateEntries, areaSalience, cellDepths, coherentAreas, figureRim, fuseAreas, mergeToTarget, regionFlatness, regionTarget,
  type Area,
} from './stencil-areas';
import { NEIGHBORS4_NESW } from '../../../core/grid/directions';
import { componentCells, labelComponents } from '../../../core/grid/cell-sets';

/** Full treatment through 24 cells on the short side, fading linearly to zero at 32. */
const SMALL_BOX_FULL = 24;
const SMALL_BOX_OFF = 32;

/** How much of the small-box treatment a box of this shape gets: 1 at or below `SMALL_BOX_FULL`, 0 at
 *  or above `SMALL_BOX_OFF`, straight between. */
export function smallBoxWeight(box: { width: number; height: number }): number {
  const side = Math.min(box.width, box.height);
  if (side <= SMALL_BOX_FULL) return 1;
  if (side >= SMALL_BOX_OFF) return 0;
  return (SMALL_BOX_OFF - side) / (SMALL_BOX_OFF - SMALL_BOX_FULL);
}

/** Share of a one-hue palette's tonal range reserved for hue separation at full weight. */
const HUE_RANGE_SHARE = 0.5;

/** The most tone a hue difference may claim, either side of where the picture's own tone landed. */
export function hueReach(weight: number, palette: ToneRange): number {
  return weight <= 0 ? 0 : (HUE_RANGE_SHARE * weight * (palette.hi - palette.lo)) / 2;
}

/** Chroma from which a colour's hue offset takes full effect; below `HUE_CHROMA_MIN` it keeps its tone. */
const HUE_CHROMA_FULL = 60;

/** Minimum weighted mass outside the dominant hue family before hue consumes tonal range. */
const HUE_FAMILY_MIN = 1 / 12;

/** Thirty-degree sectors used to identify the dominant hue family. */
const HUE_SECTORS = 12;

/** Compressive signed hue distance in [-1, 1], giving nearby color families useful separation. */
function hueLift(turn: number): number {
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
const WATER_BODY_MIN = 3;
const WATER_GROW_STEPS = 1;

/**
 * Grows undersized water bodies from eligible bright neighbours or returns them to land.
 * Mutates `isWater`, processes larger bodies first, breaks ties by cell index, and returns the number of changed cells.
 */
export function settleWaterBodies(
  stencil: Stencil,
  isWater: Uint8Array,
  weight: number,
  light: { tone: (index: number) => number | null; cut: number; step: number },
  open: (index: number) => boolean,
): number {
  const { tone, cut, step } = light;
  if (weight <= 0) return 0;
  const { width, height } = stencil;
  const floor = Number.isFinite(cut) ? cut - WATER_GROW_STEPS * step : cut;
  let moved = 0;

  // Each body's cells in raster order, so `body[0]` is its first cell.
  const { labels, sizes } = labelComponents(isWater, width, height);
  const bodies = componentCells(labels, sizes.length - 1);

  for (const body of bodies.sort((a, b) => (b.length - a.length) || (a[0]! - b[0]!))) {
    if (body.length >= WATER_BODY_MIN) continue;
    if (body.some((i) => !isWater[i])) continue;             // already grown into by a larger body
    // The lightest cells beside it that the picture would let be water, brightest first.
    const beside = new Map<number, number>();
    for (const i of body) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of NEIGHBORS4_NESW) {
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

/** Share of a flat region's palette request supplied by its region-level color. */
const AREA_SHARE = 1;

export interface SmallBoxInput {
  matchable: (index: number) => boolean;
  colorAt: (index: number) => number;
  /** `smallBoxWeight` of the stencil: 0 reads nothing. */
  weight: number;
  entries: readonly { rgb: number }[];
  /** Spend distinct entries on a bounded set of regions, as a one-hue ramp needs. */
  distinct: boolean;
  damping: number;
  /** The lowest tone an area at this depth inside the figure may take. */
  minTone?: (depth: number) => number;
}

export function readSmallBox(stencil: Stencil, input: SmallBoxInput): SmallBoxRead | null {
  const { matchable, colorAt, weight, entries, distinct, damping, minTone } = input;
  if (weight <= 0 || entries.length === 0) return null;
  // Flatness is measured per region so shaded subjects retain gradients while flat areas stay coherent.
  const read0 = coherentAreas(stencil, matchable, colorAt);
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
  const flat = regionFlatness(stencil, areas, colorAt, step);
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
      const own = colorAt(i);
      return has[i] ? blendColor(own, target[i]!, share * told[i]!) : own;
    },
    // Dither remains only where the gate and region gradients leave per-cell tone to express.
    damping: damping * (1 - share * mean),
  };
}

/** Region-aware palette requests and residual dither for a small stencil. */
interface SmallBoxRead {
  wanted: (index: number) => number | null;
  damping: number;
  /** The regions the picture was read as, in ascending first-cell order. */
  regions: Area[];
  /** The enclosing rim region's index, or -1 where the picture has no such region. */
  rim: number;
}


/** Whether another material family may represent none, a bounded accent, or any region. */
export type BorrowPolicy = 'none' | 'accent' | 'free';

/** Accent area cap and minimum channel-weighted improvement over the primary palette. */
const BORROW_ACCENT_SHARE = 1 / 3;
export const BORROW_MIN_GAIN = 24;
/** Minimum fraction of a region that must accept the borrowed material. */
export const BORROW_COVER_MIN = 0.4;

/**
 * Assigns eligible regions to a closer coating palette under the borrow policy.
 * The outline stays in the primary material; offers rank by color gain × area with stable cell-order ties.
 */
export function planBorrow(
  small: { regions: readonly Area[]; rim: number },
  own: (area: Area) => number,
  ramp: readonly { rgb: number }[],
  coatings: readonly { catalogId: string; rgb: number }[],
  policy: BorrowPolicy,
): Map<number, string> {
  const { regions, rim } = small;
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
const FILL_HUE_MAX = 40;
const FILL_BED_MIN = 2;
const FILL_BUDGET_SHARE = 1 / 16;
const FILL_MAX_REGIONS = 2;

/** One body filled: which region, the coating that says its colour, and how many cells the bed may take. */
interface ColorFill { region: number; catalogId: string; want: number }

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
export function planColorFill(
  small: { regions: readonly Area[]; rim: number },
  own: (area: Area) => number,
  ramp: readonly { rgb: number }[],
  coatings: readonly { catalogId: string; rgb: number }[],
  gate: FillGate,
): ColorFill[] {
  const { regions, rim } = small;
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
    for (const [dx, dy] of NEIGHBORS4_NESW) {
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
export function sourceColor(stencil: Stencil, area: Area): number {
  let r = 0, g = 0, b = 0;
  for (const i of area.cells) {
    const rgb = stencil.color[i] ?? 0;
    r += (rgb >> 16) & 0xff; g += (rgb >> 8) & 0xff; b += rgb & 0xff;
  }
  const n = Math.max(1, area.cells.length);
  return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
}
