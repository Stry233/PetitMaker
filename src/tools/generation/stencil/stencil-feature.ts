/*
 * stencil-feature.ts — WHICH FEW CELLS OF A PICTURE A DECORATION IS SPENT ON, and why those.
 *
 * The terrain ramp is eight greens: it can say a picture's lightness and it cannot say its colour. A
 * decoration can — a flower carries a real hue and stands on one cell — which makes it the one
 * instrument in a terrain picture that says what the ramp cannot, and it is scarce: every mark is an
 * object the load rules carry, and past a few dozen of them a figure is not marked but overdrawn.
 *
 * A SCARCE INSTRUMENT IS SPENT ON THE FEATURES THAT IDENTIFY THE SUBJECT. Those are small, they sit
 * INSIDE the figure rather than on its silhouette, they are far in colour from what surrounds them, and
 * the primary palette has nothing near their colour: an eye, a marking, a red throat. A cell that is
 * merely a strong EDGE is not one of them — the ramp draws an edge as a step perfectly well — which is
 * why ranking cells by their own gradient (what this replaces below the box gate) laid an even dotting
 * of marks over every figure and said nothing about any of them.
 *
 * The reading is PURE arithmetic over the stencil and the two palettes: no map, no rules, no randomness,
 * ties by first cell. What reaches the map is whatever the executor makes of the plan this produces, and
 * a refused mark is simply a mark that is not there.
 */
import type { Stencil } from '../../../core/model/types';
import { cellDepths, coherentAreas, colourGap, nearestEntry, type Area } from './stencil-small';

/**
 * A feature a picture identifies itself by: the cells it covers, the colour the SOURCE has there, and
 * how much of the subject's identity depends on it.
 *
 * `cells` is DEEPEST FIRST (then by index), because that is the order a mark spends them in: the
 * innermost cell of a feature is where the ground is flattest — a coating or a tier boundary runs along
 * a colour boundary, so the outermost cell of a feature is the one whose placement is refused — and a
 * mark on the inside reads as the feature rather than as a fringe of it.
 */
export interface Feature {
  cells: number[];
  /** The picture's own mean colour over the feature. */
  rgb: number;
  /** contrast x interiority x say, each as a share of the most any candidate of this picture has. */
  score: number;
  /** How far the feature's colour is from what surrounds it, contact-weighted. */
  contrast: number;
  /** The mean depth of its cells inside the figure: 1 is on the silhouette, upward inward. */
  interiority: number;
  /** How much better the accent palette says the feature's colour than the primary palette can. */
  say: number;
}

/**
 * How much of the figure a FEATURE may be, at most.
 *
 * A feature is the small thing the reduction deletes; the subject's own mass is not one, and marking it
 * would be a second picture drawn over the first. An eighth is measured rather than chosen: over the
 * benchmark a figure's largest region is about half of it and its next two about a fifth each, so an
 * eighth sits below every region a composition keeps and above the two or three cells an eye takes at
 * sixteen.
 */
export const FEATURE_MAX_SHARE = 0.125;

/**
 * How far in colour a feature has to sit from what surrounds it, in the channel-weighted units every
 * colour gap here uses (`stencil-small.ts:colourGap`).
 *
 * 24 is about a step and a half of the terrain ramp, the same gap `BORROW_MIN_GAIN` asks a borrowed
 * material to beat the ramp by: below it the picture is not drawing a boundary there, it is shading.
 */
export const FEATURE_MIN_CONTRAST = 24;

/**
 * How deep inside the figure a feature's cells have to sit on average.
 *
 * TWO, WHICH IS ONE CELL OFF THE SILHOUETTE. A mark on the outline is read as part of the outline: it
 * says where the figure ENDS, which the silhouette already says, and it is the cell terrain refuses a
 * coating or a flat placement on. What identifies a subject is inside it.
 */
export const FEATURE_DEPTH_MIN = 2;

/**
 * The depth at which being interior stops earning anything, and the size at which a feature stops
 * earning for being bigger — the two saturating terms of the ranking.
 *
 * BOTH ARE SATURATING BECAUSE BOTH ARE QUALITIES RATHER THAN QUANTITIES. An area three cells inside the
 * figure is interior; six cells inside it is not more interior, and a term that kept rewarding depth
 * ranked a one-cell speck in the middle of a face above the eye patch beside it (measured on the seed
 * picture at 24 cells: its four highest-ranked features were one cell each). Size is the same shape of
 * mistake in the other direction: a mark on four cells says more than a mark on one, and a one-cell area
 * that survived the fold is as likely to be a highlight as an eye — but past a 48th of the figure a
 * feature is fully said, and rewarding size further would walk the ranking up into the subject's own mass,
 * which `FEATURE_MAX_SHARE` exists to keep out.
 */
export const FEATURE_DEPTH_FULL = 3;
export const FEATURE_MASS_SHARE = 1 / 48;

/**
 * How much better the accent palette has to say a feature's colour than the primary palette can, before
 * a mark is worth spending on it.
 *
 * THIS IS THE TERM THAT MAKES THE INSTRUMENT AN ACCENT. A dark eye on a pale face is a feature of the
 * DRAWING, and the ramp has a dark green for it; a red throat is a feature the ramp has nothing for at
 * all. Only the second is worth a mark, because a flower planted where the terrain already said the same
 * thing adds an object and no information. Eight is half a ramp step: enough to exclude a colour the two
 * palettes say equally well, small enough to keep a feature whose hue the ramp merely approximates.
 */
export const FEATURE_SAY_MIN = 8;

/**
 * How much of the figure the whole decoration may cover in a small box, and how many features it may
 * spend that on.
 *
 * A SIXTEENTH, AND FOUR. At sixteen cells a figure is about 150 cells, so the budget is nine marks —
 * enough for two eyes and a throat, and nowhere near enough to texture anything. The count cap is what
 * keeps the budget from being spent as nine one-cell marks: a subject is identified by two or three
 * things, and a fourth is already the picture's shading rather than its identity.
 */
export const FEATURE_BUDGET_SHARE = 1 / 16;
export const FEATURE_MAX = 4;

/** How many cells of decoration a figure of this size is worth, at least one. */
export function featureBudget(figureCells: number): number {
  return Math.max(1, Math.round(figureCells * FEATURE_BUDGET_SHARE));
}

/**
 * The features of a picture, most identifying first — the reading this file exists for.
 *
 * The candidates are the picture's own coherent colour AREAS at the box's cell count
 * (`stencil-small.ts:coherentAreas`, over the SOURCE colours rather than the tone-fitted ones: what is
 * being asked is what the picture said, not what the ramp made of it). That segmentation already keeps a
 * speck that is nothing like its neighbour and folds one that is nearly its neighbour's colour into it,
 * which is exactly the difference between a two-cell eye and the noise inside a face.
 *
 * FOUR GATES, and each is a way a candidate can fail to be a feature: it must be SMALL
 * (`FEATURE_MAX_SHARE`), it must be INSIDE the figure (`FEATURE_DEPTH_MIN`), it must be far in colour
 * from what surrounds it (`FEATURE_MIN_CONTRAST`), and the accent palette must say its colour better than
 * the primary one can (`FEATURE_SAY_MIN`). What is left is RANKED on the same three terms multiplied —
 * contrast, interiority, and what the accent can say — each as a share of the most any candidate has,
 * multiplied rather than added because a candidate that fails any of the three is not a feature and a sum
 * would let a large dull one outrank a small vivid one.
 */
export function detectFeatures(
  stencil: Stencil,
  inFigure: (index: number) => boolean,
  primary: readonly { rgb: number }[],
  accent: readonly { rgb: number }[],
): Feature[] {
  if (accent.length === 0) return [];
  const { width, height } = stencil;
  const areas = coherentAreas(stencil, inFigure, (i) => stencil.color[i] ?? 0);
  const figure = areas.reduce((sum, area) => sum + area.cells.length, 0);
  if (figure === 0) return [];

  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  const depth = cellDepths(stencil, (i) => owner[i]! >= 0);

  const candidates: { area: Area; contrast: number; interiority: number; say: number }[] = [];
  for (const [id, area] of areas.entries()) {
    if (area.cells.length > figure * FEATURE_MAX_SHARE) continue;
    const interiority = area.cells.reduce((sum, i) => sum + depth[i]!, 0) / area.cells.length;
    if (interiority < FEATURE_DEPTH_MIN) continue;
    const around = surround(stencil, areas, owner, id);
    if (around === null) continue;                       // nothing touches it: no surround to stand out from
    const contrast = colourGap(area.rgb, around);
    if (contrast < FEATURE_MIN_CONTRAST) continue;
    const say = nearestEntry(primary, area.rgb).off - nearestEntry(accent, area.rgb).off;
    if (say < FEATURE_SAY_MIN) continue;
    candidates.push({ area, contrast, interiority, say });
  }
  if (candidates.length === 0) return [];

  const share = (xs: number[]): number[] => {
    const top = Math.max(...xs, 0);
    return top <= 0 ? xs.map(() => 1) : xs.map((v) => v / top);
  };
  const c = share(candidates.map((k) => k.contrast));
  const s = share(candidates.map((k) => k.say));
  const mass = Math.max(1, figure * FEATURE_MASS_SHARE);
  return candidates
    .map((k, at) => ({
      cells: [...k.area.cells].sort((a, b) => (depth[b]! - depth[a]!) || (a - b)),
      rgb: k.area.rgb,
      score: c[at]! * s[at]!
        * Math.min(1, k.interiority / FEATURE_DEPTH_FULL)
        * Math.min(1, k.area.cells.length / mass),
      contrast: k.contrast, interiority: k.interiority, say: k.say,
    }))
    .sort((a, b) => (b.score - a.score) || (a.cells[0]! - b.cells[0]!));
}

/** The colour AROUND an area: the mean of the areas it touches, weighted by how much of its border each
 *  one holds. Null where it touches nothing. */
function surround(
  stencil: Stencil, areas: readonly Area[], owner: Int32Array, id: number,
): number | null {
  const { width, height } = stencil;
  const contact = new Map<number, number>();
  for (const i of areas[id]!.cells) {
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = owner[ny * width + nx]!;
      if (other < 0 || other === id) continue;
      contact.set(other, (contact.get(other) ?? 0) + 1);
    }
  }
  if (contact.size === 0) return null;
  let r = 0, g = 0, b = 0, n = 0;
  for (const [other, weight] of contact) {
    const rgb = areas[other]!.rgb;
    r += ((rgb >> 16) & 0xff) * weight; g += ((rgb >> 8) & 0xff) * weight; b += (rgb & 0xff) * weight;
    n += weight;
  }
  return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
}

const EDGES: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** One feature realized: the item that says its colour, the cells it may be said on, and how many of
 *  them the budget affords. */
export interface FeatureMark {
  catalogId: string;
  /**
   * Every cell of the feature, INNERMOST FIRST — the order the caller must try them in.
   *
   * MORE CELLS THAN THE BUDGET AFFORDS, on purpose. A feature's own boundary is a colour boundary and so
   * a tier boundary, and a flat placement is refused a cell away from a step: whether a given cell of a
   * feature will take a mark is a fact about the terrain the primary built, which no reading of the
   * picture knows. So the plan offers the whole feature in the order it would rather spend it and the
   * caller stops at `want` marks that stood — measured on the seed picture at 24 cells, three of the four
   * features said nothing at all when the plan named its cells and the caller took only those.
   */
  cells: number[];
  /** How many marks this feature is worth: what the budget gives it. */
  want: number;
  /** Which feature of `detectFeatures`'s own ordering this realizes, 0 being the most identifying. */
  feature: number;
}

/**
 * The marks a budget buys: the most identifying features first, each told in the ONE accent whose own
 * colour is nearest to it.
 *
 * ONE ITEM PER FEATURE, not one per cell, which is what makes a feature spanning several cells read as
 * its own shape rather than as a gradient of species. A feature the budget cannot cover whole is spent
 * as far as it reaches, from the innermost cell outward — a partial mark on the middle of an eye still
 * says the eye; one spread over its rim says a ring.
 *
 * THE BUDGET IS DIVIDED BEFORE IT IS SPENT, evenly among the features that will be marked, and only then
 * is what nobody could use handed down the ranking. A plain walk gives the first feature everything it can
 * hold — and a feature may be an eighth of the figure while the whole budget is a sixteenth of it, so the
 * most identifying one would take the lot and the accent would arrive as a single patch. Several marks
 * saying several things is the composition; one patch is a second picture.
 *
 * What is left when the map refuses a feature is simply unspent: the budget is a ceiling on what a figure
 * may carry, not a quota to fill.
 */
export function planFeatureMarks(
  features: readonly Feature[],
  accent: readonly { catalogId: string; rgb: number }[],
  budget: number,
): FeatureMark[] {
  if (accent.length === 0 || budget <= 0) return [];
  const marked = features.slice(0, FEATURE_MAX)
    .map((feature) => ({ feature, entry: accent[nearestEntry(accent, feature.rgb).at] }))
    .filter((k): k is { feature: Feature; entry: { catalogId: string; rgb: number } } => Boolean(k.entry));
  if (marked.length === 0) return [];
  // An even share each, and a budget smaller than the number of features is spent on the first few:
  // `left` is the ceiling throughout, so the division can never hand out more than there is.
  const room = Math.max(1, Math.floor(budget / marked.length));
  let left = budget;
  const want = marked.map((k) => {
    const take = Math.min(room, k.feature.cells.length, left);
    left -= take;
    return take;
  });
  for (const [at, k] of marked.entries()) {
    if (left <= 0) break;
    const more = Math.min(left, k.feature.cells.length - want[at]!);
    want[at] = want[at]! + more;
    left -= more;
  }
  return marked
    .map((k, at) => ({
      catalogId: k.entry.catalogId, cells: [...k.feature.cells], want: want[at]!, feature: at,
    }))
    .filter((mark) => mark.want > 0);
}
