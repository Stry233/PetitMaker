/**
 * Writes a phrase or figure into terrain as a local cell mask. A wall banner leaves plateau cells
 * standing inside same-tier water; a ground field leaves dry glyphs inside ground-level water. Both
 * arrangements preserve the water-cap and mountain-support invariants. Local masks avoid a browser
 * font rasterizer, keeping this stage pure and worker-safe.
 */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import { makeRng, type Rng } from '../../../../core/base/rng';
import type { MacroCoord } from '../../../../core/model/types';
import type { Stencil } from '../../recipe';
import { covered } from '../../stencil/stencil';
import type { TerrainPlan } from '../../terrain-plan/types';
import type { DesignPlan, RegionPlan } from '../types';
import { isSetPieceTheme } from '../themes';
import { COURT_INK_MIN, COURT_PATTERNS, type CourtPattern, PHRASE_BANK, type Phrase, courtInk, inkOf, rasterizePhrase } from './landmark-glyphs';
import { type PanelSearch, canHold, clipRect, findPanel, rectProfile } from './landmark-panels';
import { summedArea } from '../summed-area';

// --- what a landmark is ----------------------------------------------------------------------------

type LandmarkKind = 'wall-banner' | 'ground-field' | 'terrace-court';

export interface LandmarkPlan {
  kind: LandmarkKind;
  /** The bank row that was written, or the court's own pattern. */
  phraseId: string;
  /** The flooded rectangle, glyph included. */
  panel: Rect;
  /** The calm band around the panel: what makes the figure read as figure rather than as a lake. It
   *  is reserved against planting and lots as the panel lands, and paved where it can join the
   *  network. */
  frame: Rect;
  /** The elevation the panel's water sits at: the plateau's tier for a banner, 0 for a field. */
  tier: number;
  /** The cells left standing as the glyph's strokes. */
  ink: MacroCoord[];
  scale: number;
  axis: 'h' | 'v';
}

interface LandmarkInput {
  terrain: TerrainPlan;
  /** The plaza's own centre: where a court is pulled toward when no landmark region was drawn, and
   *  the side of a panel the walk arrives from. */
  hub: MacroCoord;
  /** Where terrain may be painted at all (the sculpt's zone reading). */
  grass: Uint8Array;
  /** What must stay flat ground: the plaza, the road space, the buildings and their doorsteps. */
  flat: Uint8Array;
  /** Chebyshev distance from every cell to the nearest lot, reservation or coast — the same field
   *  the channel keeps its own room by. */
  clearance: Int16Array;
  /** The map-scale wall the banner is cut into. */
  wall: { rect: Rect; peak: number };
  /** The text or pattern landmark region the list drew, where the list drew one: a ground field lands where the
   *  plan wanted one. Absent, a field is pulled toward the plaza like a court. */
  region?: RegionPlan;
  seed: number;
  richness: number;
}

// --- tunables ------------------------------------------------------------------------------------

/** Cells of water between the glyph and the panel's own edge. A banner is 14 rows deep around a
 *  12-row phrase; a ground field is far roomier than its letters. */
const BANNER_PAD = 1;
const FIELD_PAD = 2;
/** Cell scales tried, largest first: scale 2 draws a banner (letters 10x12, strokes 2 cells), scale 1
 *  a ground field (letters 5x6, strokes 1). */
const SCALES = [2, 1] as const;
/**
 * The field's own scales, and it is offered one more than the banner.
 *
 * A field's ink is ground left standing rather than a wall stroke, so a fat letter reads as a platform
 * in a pool and not as a thick line — and the scale is what lets a text form answer the big rung at
 * all: at scale 2 a lone figure fills 18x18 and the big rung asks for 600 cells, so the
 * court answered every planet that could carry one. Scale 3 lets a field reach that rung.
 */
const FIELD_SCALES = [3, 2, 1] as const;
/** The lowest wall tier worth writing a banner on. Below this the plateau is a rise, not a wall, and
 *  a phrase across it does not read as a signboard. */
const BANNER_MIN_TIER = 2;
/** Open ground a ground-level field keeps around itself. Same reading as the channel's own keep: what
 *  a body of water leaves beside it must still be a road's width of ground, or the water and the lots
 *  beyond it are one wall across the network. A raised field is tested by its ring instead. */
const FIELD_KEEP = 2;
/**
 * How often a map builds a landmark below `SET_PIECE_FROM`, at richness 0 and that threshold.
 *
 * A quiet planet is a garden town and a set piece written across it is not what the axis is for, so
 * down there the text or pattern landmark stays occasional. At and above the threshold the roll is gone: the map is
 * required to carry one figure, per the size ladder below.
 */
const OCCURRENCE = { min: 0.4, max: 0.6 } as const;
/**
 * The richness from which a planet must carry its one figure, and its size: without a primary set
 * piece a map is an even field of interchangeable blocks. `SET_PIECE_WANT` is the size drawn wherever
 * the planet has room; `SET_PIECE_MIN` is the smallest panel still called a figure, set from the
 * clear ground left on the tightest seeds after streets and lots are reserved. The wanted size is
 * tried on every tier before the smaller one.
 */
const SET_PIECE_FROM = 0.5;
const SET_PIECE_WANT = 300;
export const SET_PIECE_MIN = 120;
/**
 * The panel a full-richness planet is asked for first: a centrepiece clearly larger than anything
 * else, which panels from `COURT_SIZES` never reach. `floorPanel` offers the largest rectangle the
 * tier's clear ground holds, so the figure takes the scale of its ground; the rung sits where most
 * planets can answer and the ladder falls back below it. The aspect cap stops a long sliver winning
 * on area, and the area cap keeps a terrace for the streets.
 */
export const SET_PIECE_BIG = 600;
const COURT_ASPECT_MAX = 7;
const COURT_AREA_MAX = 1100;
/**
 * The calm band around a figure, in cells, and the sizes a summit court is tried at. A banner is
 * framed by a road border 3 rows deep, so the band is reserved as calm ground when the
 * panel lands and paved where it can join the network. Clear one-tier ground runs long rather than
 * square, so courts are long panels, tried largest area first.
 */
const FRAME_PAD = 3;
const COURT_SIZES: readonly { w: number; h: number }[] = [
  { w: 34, h: 16 }, { w: 30, h: 14 }, { w: 40, h: 10 }, { w: 46, h: 8 }, { w: 26, h: 14 },
  { w: 52, h: 7 }, { w: 60, h: 6 }, { w: 24, h: 13 }, { w: 22, h: 14 }, { w: 26, h: 10 },
  { w: 30, h: 8 }, { w: 20, h: 12 }, { w: 34, h: 7 }, { w: 26, h: 7 }, { w: 18, h: 10 },
  { w: 22, h: 8 }, { w: 16, h: 9 }, { w: 20, h: 7 }, { w: 14, h: 9 }, { w: 12, h: 10 },
];

// --- the entry points --------------------------------------------------------------------------------

/** The text or pattern landmark region, where the region list drew one. It only says where a ground
 *  field would rather stand: a landmark's gates are `SET_PIECE_FROM` (with `OCCURRENCE` below it)
 *  and finding a panel at all. */
export function landmarkRegion(plan: DesignPlan): RegionPlan | null {
  return plan.regions.find((r) => isSetPieceTheme(r.themeId)) ?? null;
}

/**
 * Write the map's one figure, or nothing where no form fits anywhere legal.
 *
 * The three placements are tried in a seeded order and the phrase is drawn from the bank, but no
 * choice can force a shape onto ground that will not carry it: a panel is only taken where the whole
 * of it plus its surrounding ring already stands as the construction needs, so a landmark that would
 * ship mangled is simply not built.
 *
 * One per planet, never two: the pass returns at the first form that lands, and the size floor is
 * what keeps the one it returns the map's biggest composed thing rather than another ornament.
 */
export function carveLandmark(input: LandmarkInput): LandmarkPlan | null {
  const rng = makeRng((input.seed ^ 0x1a4d3a2c) >>> 0);
  const r = input.richness < 0 ? 0 : input.richness > 1 ? 1 : input.richness;
  if (r < SET_PIECE_FROM
    && rng.float() >= OCCURRENCE.min + (OCCURRENCE.max - OCCURRENCE.min) * r) return null;
  // The floor binds where a figure is required. Below that a landmark is an occasional ornament and
  // the ground a quiet planet offers is smaller, so a small one is better than none.
  const floor = r >= SET_PIECE_FROM ? SET_PIECE_MIN : 0;

  // The drawn phrase leads and the rest of the bank follows it, so a map that cannot carry home
  // anywhere writes something rather than nothing.
  const wanted = drawPhrase(rng);
  const phrases = [wanted, ...PHRASE_BANK.filter((p) => p !== wanted)];
  // The wall is the terraced planet's placement and the ground field is the cheap version of it (the
  // garden town's), so the banner is asked first on two maps in three. The court is asked last and is
  // the form that does not depend on a phrase fitting: a flooded terrace with a pattern standing in
  // it, which is what a planet with room for the figure but not for the words gets.
  const pattern = COURT_PATTERNS[rng.int(COURT_PATTERNS.length)]!;
  const courts = courtSearches(input);
  const banners = bannerSearches(input);
  const fields = fieldSearches(input);
  // The family is a choice, not a consequence of which one could answer the largest rung.
  // Choose a family first, then try its size rungs. Comparing every family at each rung would favor
  // terrace courts because their panels are usually larger than phrase panels.
  const preferred = drawKind(rng, r);
  const rungs = [SET_PIECE_BIG, SET_PIECE_WANT, floor]
    .filter((v, k, all) => v >= floor && all.indexOf(v) === k);
  const ask = (kind: LandmarkKind, want: number): Found | null => {
    if (kind === 'terrace-court') return planCourt(want, pattern, courts);
    for (const phrase of phrases) {
      const found = kind === 'wall-banner' ? planBanner(phrase, banners) : planField(phrase, fields);
      if (found && found.panel.w * found.panel.h >= want) return found;
    }
    return null;
  };
  for (const want of rungs) {
    const found = ask(preferred, want);
    if (found) return commit(input.terrain, found);
  }
  // If the chosen family cannot fit, use the largest viable panel from the remaining families.
  const rest = KIND_WEIGHTS.map((w) => w.kind).filter((k) => k !== preferred);
  for (const want of rungs) {
    for (const kind of rest) {
      const found = ask(kind, want);
      if (found) return commit(input.terrain, found);
    }
  }
  return null;
}

/**
 * How often each family is the one a seed sets out to build.
 *
 * The wall banner is the terraced planet's set piece and the ground field is the garden town's, so the
 * two text forms carry most of the weight between them; the court is the form that depends on no phrase
 * fitting, which makes it both the most reliable and — left to win by reliability alone — the one that
 * turns up on every planet.
 */
const KIND_WEIGHTS: ReadonlyArray<{ kind: LandmarkKind; low: number; high: number }> = [
  { kind: 'wall-banner', low: 0.5, high: 3 },
  { kind: 'ground-field', low: 1, high: 3 },
  { kind: 'terrace-court', low: 4, high: 3 },
];

/**
 * The family this seed sets out to build, drawn by weight against richness.
 *
 * The quiet end leans on the court, and that is the arrival rule rather than taste: a flat garden town
 * carries no cascade and few composed bodies, so its court is the one thing on it built to be arrived
 * at, and the two text forms both want a large clear panel a low-relief planet rarely has; drawn evenly
 * down there, street ends arrive at nothing.
 * At full richness the three are even, so no one form is the planet's answer twice over.
 */
function drawKind(rng: Rng, richness: number): LandmarkKind {
  const weights = KIND_WEIGHTS.map((w) => w.low + (w.high - w.low) * richness);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.float() * total;
  for (const [k, w] of weights.entries()) {
    roll -= w;
    if (roll <= 0) return KIND_WEIGHTS[k]!.kind;
  }
  return KIND_WEIGHTS[KIND_WEIGHTS.length - 1]!.kind;
}

/** One phrase, drawn by weight. */
function drawPhrase(rng: Rng): Phrase {
  let total = 0;
  for (const p of PHRASE_BANK) total += p.weight;
  let roll = rng.float() * total;
  for (const p of PHRASE_BANK) {
    roll -= p.weight;
    if (roll <= 0) return p;
  }
  return PHRASE_BANK[PHRASE_BANK.length - 1]!;
}

/** The cells a landmark claims, panel and frame: what the decoration pass must leave alone. A plant
 *  standing on a letter is a letter that cannot be read, a stroke two cells wide carries plantable
 *  ground down its middle, and a bed planted against the panel's edge is the framing gone. */
export function landmarkCells(plan: LandmarkPlan, W: number, H: number): Set<number> {
  const out = new Set<number>();
  const { frame } = plan;
  for (let y = frame.y; y < frame.y + frame.h; y++) {
    for (let x = frame.x; x < frame.x + frame.w; x++) {
      if (x >= 0 && y >= 0 && x < W && y < H) out.add(flatIndex(x, y, W));
    }
  }
  return out;
}

// --- planning the two placements ---------------------------------------------------------------------

interface Found {
  kind: LandmarkKind;
  phraseId: string;
  panel: Rect;
  tier: number;
  stencil: Stencil;
  pad: number;
  scale: number;
  axis: 'h' | 'v';
}

/**
 * The banner: the largest scale that fits anywhere on the wall wins, and at one scale the highest
 * tier that carries it.
 *
 * A panel's inside must be untouched wall standing at exactly the panel's tier, and the ring around
 * it must stand at that tier or higher and hold no water — which is precisely the condition under
 * which the flood shows no face, so the legality argument and the search are the same test.
 */
function planBanner(phrase: Phrase, cache: TierSearches): Found | null {
  for (const scale of SCALES) {
    const stencil = rasterizePhrase(phrase.glyphs, scale, 'h');
    if (!stencil) continue;
    const w = stencil.width + 2 * BANNER_PAD, h = stencil.height + 2 * BANNER_PAD;
    for (const tier of cache.keys) {
      const search = cache.at(tier);
      if (!search || !canHold(search, w, h)) continue;
      const panel = findPanel(search, w, h);
      if (panel) {
        return { kind: 'wall-banner', phraseId: phrase.id, panel, tier, stencil, pad: BANNER_PAD, scale, axis: 'h' };
      }
    }
  }
  return null;
}

/**
 * The banner's per-tier searches, and the field's per-clearance ones: built once per map and read by
 * every phrase the bank offers.
 *
 * A search is two summed-area tables over the whole map. Built inside the placement functions they
 * would be rebuilt on every call: the bank calls once per phrase and the size ladder calls twice, up to
 * ten times for the banner alone.
 */
interface TierSearches {
  keys: readonly number[];
  at(key: number): PanelSearch | null;
}

function bannerSearches(input: LandmarkInput): TierSearches {
  const { terrain: t, wall } = input;
  const area = wall.peak >= BANNER_MIN_TIER && wall.rect.w >= 8 && wall.rect.h >= 4
    ? clipRect(wall.rect, t.width, t.height) : null;
  const keys: number[] = [];
  if (area) for (let tier = wall.peak; tier >= BANNER_MIN_TIER; tier--) keys.push(tier);
  const toward = area ? { x: area.x + area.w / 2, y: area.y + area.h / 2 } : { x: 0, y: 0 };
  const built = new Map<number, PanelSearch | null>();
  return {
    keys,
    at(tier: number) {
      if (built.has(tier)) return built.get(tier)!;
      let made: PanelSearch | null = null;
      if (area) {
        // A panel's inside must be untouched wall standing at exactly the panel's tier, and the ring
        // around it must stand at that tier or higher and hold no water — which is precisely the
        // condition under which the flood shows no face, so the legality argument and the search are the
        // same test.
        const inside = new Uint8Array(t.width * t.height);
        const ring = new Uint8Array(t.width * t.height);
        for (let i = 0; i < inside.length; i++) {
          const dry = t.water[i]! < 0;
          if (dry && t.tier[i]! >= tier) ring[i] = 1;
          if (dry && t.tier[i] === tier && input.grass[i] === 1 && !input.flat[i]) inside[i] = 1;
        }
        made = {
          W: t.width, H: t.height, area, toward,
          profile: rectProfile(inside, t.width, area),
          inside: summedArea(inside, t.width, t.height),
          ring: summedArea(ring, t.width, t.height),
        };
      }
      built.set(tier, made);
      return made;
    },
  };
}

function fieldSearches(input: LandmarkInput): TierSearches {
  const { terrain: t } = input;
  const lot = input.region?.lot[0];
  const area = clipRect({ x: 1, y: 1, w: t.width - 2, h: t.height - 2 }, t.width, t.height);
  const toward = lot
    ? { x: lot.x + lot.w / 2, y: lot.y + lot.h / 2 }
    : { x: input.hub.x, y: input.hub.y };
  // A field is a banner written off the wall, so it is asked of every tier and not of elevation 0
  // alone. At full richness the relief floor leaves a planet with almost no ground at 0: asked of
  // elevation 0 alone the form lands on none of twenty maps and the court answers every one of them,
  // which is one form on every planet again. The legality argument is the
  // banner's, unchanged: water at the panel's tier with its ring at that tier or above shows no face,
  // and a letter left standing at the same tier keeps the 3x3 window it had before the flood.
  // A raised field is a terraced-planet form. Below the set-piece richness the map is a garden town and
  // the ground field is its own ground-level version, as a garden town draws it.
  // The raised variant down there takes ground the street ends need, and the arrival rule then reads
  // those ends as arriving at nothing.
  const tiers: number[] = [];
  const top = input.richness >= SET_PIECE_FROM ? Math.max(input.wall.peak, 0) : 0;
  for (let tier = top; tier >= 0; tier--) tiers.push(tier);
  const built = new Map<number, PanelSearch | null>();
  return {
    keys: tiers,
    at(tier: number) {
      if (built.has(tier)) return built.get(tier)!;
      let made: PanelSearch | null = null;
      if (area) {
        const inside = new Uint8Array(t.width * t.height);
        const ring = new Uint8Array(t.width * t.height);
        for (let i = 0; i < inside.length; i++) {
          const dry = t.water[i]! < 0;
          if (dry && t.tier[i]! >= tier) ring[i] = 1;
          // The open-ground keep is the ground-level form's own: at 0 a field is cut into the town's
          // own floor, and what it leaves beside it must still be a road's width of ground. A raised
          // field stands on a terrace the streets already declined, so its ring is the test instead.
          if (dry && t.tier[i] === tier && input.grass[i] === 1 && !input.flat[i]
            && (tier > 0 || input.clearance[i]! >= FIELD_KEEP)) inside[i] = 1;
        }
        made = {
          W: t.width, H: t.height, area, toward,
          profile: rectProfile(inside, t.width, area),
          inside: summedArea(inside, t.width, t.height),
          // Ground level faces nothing lower, so a field down there needs no ring above it.
          ...(tier > 0 ? { ring: summedArea(ring, t.width, t.height) } : {}),
        };
      }
      built.set(tier, made);
      return made;
    },
  };
}

/**
 * The ground field: a flooded rectangle on the open ground the landmark region was planned into,
 * with the letters standing dry inside it.
 *
 * The lot itself is rarely big enough (a full field is 18x28 against a 21x15 lot), so the search takes
 * the whole map and is only pulled toward the lot, which is what puts the field on the town's flank. It is tried at the roomiest clearance first, so a field
 * lands in genuinely open ground where the map has any.
 */
function planField(phrase: Phrase, cache: TierSearches): Found | null {
  // Size before room. A full field is 18x28 around 5x6 letters, so a landmark drawn small in the
  // roomiest pocket is further from it than one drawn full size in a tighter one.
  for (const scale of FIELD_SCALES) {
    // Down the y axis first: a field is read side-on from the plaza, so its letters stack
    // rather than run.
    for (const axis of ['v', 'h'] as const) {
      const stencil = rasterizePhrase(phrase.glyphs, scale, axis);
      if (!stencil) continue;
      const w = stencil.width + 2 * FIELD_PAD, h = stencil.height + 2 * FIELD_PAD;
      for (const tier of cache.keys) {
        const search = cache.at(tier);
        if (!search || !canHold(search, w, h)) continue;
        const panel = findPanel(search, w, h);
        if (panel) {
          return { kind: 'ground-field', phraseId: phrase.id, panel, tier, stencil, pad: FIELD_PAD, scale, axis };
        }
      }
    }
  }
  return null;
}

function planCourt(floor: number, pattern: CourtPattern, cache: CourtSearches): Found | null {
  for (const tier of cache.tiers) {
    // The tier is asked one question first. A tier whose largest inscribable rectangle is smaller than
    // the floor cannot answer any size in the ladder, and its own mask is cheaper to measure than one
    // position sweep.
    const search = cache.at(tier);
    if (!search) continue;
    // The terrace floor leads, and the list is what a tier too small for it falls back to.
    const sizes = [...floorPanel(search), ...COURT_SIZES];
    for (const size of sizes) {
      for (const [w, h] of [[size.w, size.h], [size.h, size.w]] as const) {
        if (w * h < floor || !canHold(search, w, h)) continue;
        const panel = findPanel(search, w, h);
        if (!panel) continue;
        // The pattern stands in the middle of the water, and how far in scales with the panel: the
        // full banner is 130 cells of ink inside 772 of water, so a figure drawn to the edge of a
        // full-size panel is a paved terrace with a moat rather than one big composed body.
        const pad = courtPad(w, h);
        // A pattern the panel cannot carry is not drawn thin, it is exchanged for the one every panel
        // can: a cross's arms and an islet grid both need room, and drawn into a small panel they came
        // out as four cells of mass in a pool.
        let ink = courtInk(w - 2 * pad, h - 2 * pad, pattern);
        if (inkOf(ink) < COURT_INK_MIN) ink = courtInk(w - 2 * pad, h - 2 * pad, 'medallion');
        if (inkOf(ink) < COURT_INK_MIN) continue;
        return {
          kind: 'terrace-court', phraseId: pattern, panel, tier, stencil: ink, pad,
          scale: 1, axis: w >= h ? 'h' : 'v',
        };
      }
    }
  }
  return null;
}

/**
 * The largest rectangle this tier's clear ground can hold, within the aspect and area caps: the
 * terrace floor offered as a panel size, or nothing where the tier holds no room worth the name.
 *
 * Each width is offered twice — the tallest rectangle that fits at all, and the same trimmed to the
 * aspect cap, since a room 6 cells wide and 60 tall holds no panel this pass may take but holds a 6x42
 * one it may. (Written as a rounding of the width to a multiple of the cap, which is what the first cut
 * shipped, that second candidate came out 6x7: the clamp belongs on the height.)
 */
function floorPanel(s: PanelSearch): { w: number; h: number }[] {
  let best: { w: number; h: number } | null = null;
  for (let w = 1; w < s.profile.length; w++) {
    const tall = s.profile[w] ?? 0;
    for (const h of [tall, Math.min(tall, w * COURT_ASPECT_MAX)]) {
      if (h < 1) continue;
      const area = Math.min(w * h, COURT_AREA_MAX);
      if (Math.max(w, h) > COURT_ASPECT_MAX * Math.min(w, h)) continue;
      // A panel over the area cap is trimmed on both axes by the square root of the overshoot, so it
      // keeps the aspect of the room it was found in rather than turning into a strip.
      const scale = area / (w * h);
      const shrink = scale < 1 ? Math.sqrt(scale) : 1;
      const fit = {
        w: Math.max(1, Math.floor(w * shrink)),
        h: Math.max(1, Math.floor(h * shrink)),
      };
      if (!best || fit.w * fit.h > best.w * best.h) best = fit;
    }
  }
  return best && best.w * best.h >= SET_PIECE_WANT ? [best] : [];
}

/** How far a court's pattern stands inside its panel: `FIELD_PAD` on a small one, a fifth of the short
 *  side on a large one, which is what leaves the water around the figure reading as the page. */
const courtPad = (w: number, h: number): number =>
  Math.max(FIELD_PAD, Math.round(Math.min(w, h) * COURT_INK_INSET));

const COURT_INK_INSET = 0.2;

/**
 * The court's per-tier panel searches, built once and read by both size passes.
 *
 * A tier's search is two summed-area tables over the whole map, and the ladder asks about forty
 * size-and-orientation pairs against each of them; building them per pass doubled the pass's cost on
 * exactly the seeds that need the second one. `room` is the tier's own total, so a size larger than all
 * the ground a tier holds is rejected without a scan.
 */
interface CourtSearches {
  tiers: readonly number[];
  at(tier: number): (PanelSearch & { room: number }) | null;
}

function courtSearches(input: LandmarkInput): CourtSearches {
  const { terrain: t, wall } = input;
  const area = clipRect({ x: 1, y: 1, w: t.width - 2, h: t.height - 2 }, t.width, t.height);
  const toward = wall.peak > 0
    ? { x: wall.rect.x + wall.rect.w / 2, y: wall.rect.y + wall.rect.h / 2 }
    : { x: input.hub.x, y: input.hub.y };
  const tiers: number[] = [];
  for (let tier = Math.max(wall.peak, 0); tier >= 0; tier--) tiers.push(tier);
  const built = new Map<number, (PanelSearch & { room: number }) | null>();
  const self: CourtSearches = {
    tiers,
    at(tier: number) {
      if (built.has(tier)) return built.get(tier)!;
      let made: (PanelSearch & { room: number }) | null = null;
      if (area) {
        const inside = new Uint8Array(t.width * t.height);
        const ring = new Uint8Array(t.width * t.height);
        let room = 0;
        for (let i = 0; i < inside.length; i++) {
          const dry = t.water[i]! < 0;
          if (dry && t.tier[i]! >= tier) ring[i] = 1;
          if (dry && t.tier[i] === tier && input.grass[i] === 1 && !input.flat[i]) { inside[i] = 1; room++; }
        }
        // Ground level faces nothing lower, so a court down there needs no ring above it — which is what
        // lets the form still land on a flat garden town.
        made = {
          W: t.width, H: t.height, area, toward, room,
          profile: rectProfile(inside, t.width, area),
          inside: summedArea(inside, t.width, t.height),
          ...(tier > 0 ? { ring: summedArea(ring, t.width, t.height) } : {}),
        };
      }
      built.set(tier, made);
      return made;
    },
  };
  return self;
}

// --- writing it ---------------------------------------------------------------------------------------

/** Flood the panel and leave the glyph standing. A banner's water sits at the plateau's tier and its
 *  ink keeps the wall it was cut from; a field's water sits at 0 and its ink is the ground itself,
 *  so neither ever raises a cell. */
function commit(t: TerrainPlan, found: Found): LandmarkPlan {
  const { panel, pad, stencil, tier } = found;
  const ink: MacroCoord[] = [];
  for (let y = 0; y < panel.h; y++) {
    for (let x = 0; x < panel.w; x++) {
      const i = flatIndex(panel.x + x, panel.y + y, t.width);
      if (covered(stencil, x - pad, y - pad)) {
        ink.push({ x: panel.x + x, y: panel.y + y });
        continue;
      }
      t.tier[i] = 0;
      t.water[i] = tier;
    }
  }
  return {
    kind: found.kind, phraseId: found.phraseId, panel, frame: grow(panel, FRAME_PAD), tier, ink,
    scale: found.scale, axis: found.axis,
  };
}

/** A rectangle grown by `pad` on every side. */
const grow = (r: Rect, pad: number): Rect =>
  ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });

/** The frame's own cells, panel excluded and clipped to the map: the band the pipeline paves and the
 *  decoration pass leaves alone. */
export function frameCells(plan: LandmarkPlan, W: number, H: number): MacroCoord[] {
  const { panel, frame } = plan;
  const out: MacroCoord[] = [];
  for (let y = frame.y; y < frame.y + frame.h; y++) {
    for (let x = frame.x; x < frame.x + frame.w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (x >= panel.x && y >= panel.y && x < panel.x + panel.w && y < panel.y + panel.h) continue;
      out.push({ x, y });
    }
  }
  return out;
}
