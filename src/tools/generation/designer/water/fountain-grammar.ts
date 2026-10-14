/**
 * The fountain grammar: what a court looks like before it has a place on the map. An outline (a
 * square, octagonal, ring or cross level set), bands that alternate water and dry from the outside
 * in, and a raised figure at the centre, every set symmetric about both axes of the composition.
 */
import type { MacroCoord } from '../../../../core/model/types';
import { seedHash01 } from '../../../../core/base/hash';

/** How deep the nesting goes, by span. A court with no room for a platform is one basin. */
const DEPTH_MAX = 3;
/**
 * The fewest levels of the outline metric a water band may be drawn at, and a dry one.
 *
 * Two is not a taste choice for the water. `waterBodies` decomposes 4-connected, and one level of the
 * octagon, ring or cross metric is a ring that meets itself only at its diagonals: it comes apart into
 * pieces under the accent floor, so a court drawn with a one-level moat is invisible to `isCourt`, to
 * the one-main-fountain rule and to the arrival reading alike. Two levels is also what the cross needs
 * to enclose anything, since a step off its arms costs `CROSS_FLARE`.
 */
const MOAT_MIN = 2;
const PLATFORM_MIN = 1;

export type FountainOutline = 'square' | 'octagon' | 'ring' | 'cross';

/** One band of the composition, outside in. The first is always water: a court reads as a fountain
 *  because it is ringed by its moat. */
interface FountainBand {
  width: number;
  water: boolean;
}

/** The grammar's own output: what a court looks like, before it has a place on the map. */
export interface FountainSpec {
  outline: FountainOutline;
  /** Half-span: the water spans `2 * radius + 1` cells. */
  radius: number;
  bands: FountainBand[];
  /** Half-span of the mountain figure at the centre. Never negative: every court stands one, at
   *  every nesting depth. */
  figure: number;
}

// --- the grammar --------------------------------------------------------------------------------

/**
 * One instance of the grammar: an outline, a nesting and a figure, from the seed and the site's
 * room. Bands alternate from the outside in, starting wet (moat, platform, basin), and the centre
 * always carries the figure.
 *
 * Every water band is `MOAT_MIN` levels deep: a one-level ring touches itself only at diagonals, so
 * `waterBodies` shatters it and the court vanishes from every downstream reading (`isCourt`, the
 * per-region rule, `placeArrivals`). The figure is innermost and the bands are drawn round it, so an
 * even-depth nesting never ends as a ring round a bare platform.
 */
export function fountainSpec(seed: number, k: number, radius: number): FountainSpec {
  const outlines: readonly FountainOutline[] = ['square', 'octagon', 'ring', 'cross'];
  const outline = outlines[Math.floor(seedHash01(seed ^ 0x0f0a, k) * outlines.length)]!;
  const levels = radius + 1;
  /** The levels `n` further bands need at their own floors, the next one wet or dry as given. */
  const need = (n: number, wet: boolean): number => {
    let sum = 0;
    for (let i = 0; i < n; i++) { sum += wet ? MOAT_MIN : PLATFORM_MIN; wet = !wet; }
    return sum;
  };
  // The deepest nesting this span affords, at the floors above plus one level for the figure.
  let depth = Math.max(1, Math.min(DEPTH_MAX, 1 + Math.floor(seedHash01(seed ^ 0x51c3, k * 3) * DEPTH_MAX)));
  while (depth > 1 && need(depth, true) + 1 > levels) depth--;
  const bands: FountainBand[] = [];
  let left = levels;
  for (let b = 0; b < depth; b++) {
    const water = b % 2 === 0;
    const floorWidth = water ? MOAT_MIN : PLATFORM_MIN;
    // What the bands still to come need, plus the level the figure stands on.
    const reserve = need(depth - 1 - b, !water) + 1;
    const width = Math.max(floorWidth, Math.min(left - reserve,
      floorWidth + Math.floor(seedHash01(seed ^ 0x2ad9, k * 7 + b) * 2)));
    bands.push({ width, water });
    left -= width;
  }
  return { outline, radius, bands, figure: Math.max(0, left - 1) };
}

/**
 * The metric a court's outline is a level set of. Chebyshev draws a square, Euclidean a ring, the two
 * averaged an octagon, and the fourth penalises the shorter of the two offsets so the level set keeps
 * four arms: a cruciform basin, the outline a street-corner fountain takes.
 *
 * The cross is the one that needs an argument. `max(ax, ay)` alone reaches `radius` in every
 * direction; adding `CROSS_FLARE` per cell of the shorter offset past the arm's own half-width costs
 * a diagonal cell far more than an axial one, so a cell on an arm is inside the level set out to the
 * full radius and a cell off it is excluded within two. Every entry stays symmetric in ax and ay and
 * about the diagonal, which is what keeps the composition mirrored about both of its axes whatever
 * the seed drew — the property the whole grammar rests on.
 */
export function outlineMetric(outline: FountainOutline, dx: number, dy: number): number {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  switch (outline) {
    case 'square': return Math.max(ax, ay);
    case 'ring': return Math.round(Math.hypot(ax, ay));
    case 'cross': return Math.max(ax, ay) + CROSS_FLARE * Math.max(0, Math.min(ax, ay) - CROSS_ARM);
    default: return Math.max(Math.max(ax, ay), Math.round((ax + ay) * 0.75));
  }
}

/**
 * The cross's arm half-width, and what a cell off the arms costs.
 *
 * The flare is one because a band has to be 4-CONNECTED. At two, the metric climbs two levels per
 * diagonal step, so a band two levels deep skips a rung as it turns the corner between two arms and
 * the ring falls into four pieces — each thinner than the accent floor, which is what made a
 * cruciform court invisible to `isCourt`, to the one-main-fountain rule and to the arrival reading
 * alike: of eighteen measured maps carrying a large court, the only three whose court could not be seen
 * were the crosses. At one, the band's diagonal staircase is two cells
 * wide and joins up, and the arms still read: a cell on an arm is inside the level set to the full
 * radius, one off it by three cells is not.
 */
const CROSS_ARM = 1;
const CROSS_FLARE = 1;

/** The court's cells, split by what they are: the water bands, the mountain figure, and the dry
 *  platforms between them. Every set is symmetric about both axes of the composition. */
export function fountainCells(
  spec: FountainSpec, centre: MacroCoord,
): { water: MacroCoord[]; figure: MacroCoord[]; dry: MacroCoord[] } {
  const water: MacroCoord[] = [], figure: MacroCoord[] = [], dry: MacroCoord[] = [];
  for (let dy = -spec.radius; dy <= spec.radius; dy++) {
    for (let dx = -spec.radius; dx <= spec.radius; dx++) {
      const d = outlineMetric(spec.outline, dx, dy);
      if (d > spec.radius) continue;
      const at = { x: centre.x + dx, y: centre.y + dy };
      if (spec.figure >= 0 && d <= spec.figure) { figure.push(at); continue; }
      (bandAt(spec, d).water ? water : dry).push(at);
    }
  }
  return { water, figure, dry };
}

/** Which band a cell at metric distance `d` from the centre belongs to. */
function bandAt(spec: FountainSpec, d: number): FountainBand {
  let outer = spec.radius;
  for (const band of spec.bands) {
    if (d > outer - band.width) return band;
    outer -= band.width;
  }
  return spec.bands[spec.bands.length - 1]!;
}
