/**
 * The map's one SET PIECE (文字/图案景观): a phrase or a figure written into the terrain.
 *
 * The style target carries two of them, and they are the two this stage builds:
 *  - THE WALL BANNER. A rectangle of the backing wall's plateau is flooded at the plateau's own
 *    tier and the glyph is the wall left STANDING inside it — water is the page, the mountain top is
 *    the stroke. The reference's own is 68x14 cells at elevation 8, stroke weight 1 to 2, letter height
 *    12, framed by pavement so it reads as a signboard rather than as a lake.
 *  - THE GROUND FIELD. The same idea with the polarity inverted: a ground-level water rectangle on
 *    open ground, the letters standing as dry ground inside it (the reference's 18x28 field, letters
 *    about 5x6, read side-on from the plaza).
 *
 * BOTH ARE LEGAL BY CONSTRUCTION, by the same two readings the rest of the sculpt uses:
 *  - V-WTR-02 asks for caps only where a water cell FACES something lower. The banner's panel sits
 *    strictly inside the plateau, so every cell around it — ring, neighbouring water, and the glyph
 *    itself — stands at the panel's own tier or above, and the panel shows no face at all. The
 *    ground field is at elevation 0, and nothing is lower than that.
 *  - V-MTN-03 reads a water cell as support up to its own surface (a waterfall is carved by
 *    CONVERTING a block, so the conversion cannot lower the neighbourhood it stands in). A stroke of
 *    wall at tier N surrounded by water at N therefore keeps the whole 3x3 window it had before the
 *    flood, and the letters survive the repair fixpoint instead of being eaten by it.
 *
 * THE GLYPHS ARE AUTHORED HERE, as cell masks, and that is a constraint rather than a preference:
 * drawing a letter from a font needs a canvas, and the only rasterizer in the tree is a browser one
 * on the main thread (the generator runs inside the worker pool, browser-API-free by contract). What
 * is shared with that path is the `Stencil` the rasterizer produces and the reading of it, so a
 * canvas-drawn phrase could be handed to `layPhrase` unchanged.
 *
 * Pure and deterministic per (seed, plan, terrain): no state, no commands, no browser API.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import { makeRng, type Rng } from '../../../../core/model/rng';
import type { MacroCoord, Rect, Stencil } from '../../../../core/model/types';
import { covered } from '../../stencil/stencil';
import type { TerrainPlan } from '../../core/types';
import type { DesignPlan, RegionPlan } from '../types';

// --- the glyph bank ------------------------------------------------------------------------------

/**
 * The alphabet, 5 cells wide and 6 tall — the letter size in the target's own ground field, and half the
 * size of its banner's, which `SCALES` reaches by doubling.
 *
 * A `#` is ink. Every row of a glyph is the same length as its first, which `glyphBank.test.ts`
 * holds, so a typo in a drawing fails the build rather than shifting a letter.
 */
const LETTERS: Readonly<Record<string, readonly string[]>> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '.####'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '....#', '....#', '....#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '###..', '###..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#..#.', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '...#.', '..#..', '.#...', '#....', '#####'],
};

/** The figures, drawn a little wider than a letter so a lone one still fills a panel. */
const FIGURES: Readonly<Record<string, readonly string[]>> = {
  HEART: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  STAR: ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '##...##'],
  PAW: ['.##.##.', '.##.##.', '##...##', '.#####.', '#######', '.#####.'],
};

export const GLYPHS: Readonly<Record<string, readonly string[]>> = { ...LETTERS, ...FIGURES };

/** One thing the map can be made to say. Adding a row is the whole of extending the bank, provided
 *  every glyph it names is drawn above. */
export interface Phrase {
  id: string;
  /** Keys into `GLYPHS`, in reading order. */
  glyphs: readonly string[];
  /** Draw weight. A WORD is the reference's own grammar and a lone figure is the cheap version of
   *  it, so the words are drawn oftener — and a figure fits almost any panel, which without a
   *  weight would make it the answer nearly every time. */
  weight: number;
}

export const PHRASE_BANK: readonly Phrase[] = [
  { id: 'home', glyphs: ['H', 'O', 'M', 'E'], weight: 3 },
  { id: 'i-love-you', glyphs: ['I', 'HEART', 'U'], weight: 3 },
  { id: 'heart', glyphs: ['HEART'], weight: 1 },
  { id: 'star', glyphs: ['STAR'], weight: 1 },
  { id: 'paw', glyphs: ['PAW'], weight: 1 },
];

// --- rasterizing a phrase --------------------------------------------------------------------------

/**
 * A phrase as a `Stencil`: the same structure the browser rasterizer hands the generator, so the two
 * ways of drawing a shape read identically downstream. Colour is unused here — the glyph is built out
 * of terrain, which has its own — and every cell's four quadrants carry its own coverage, since a
 * cell mask has no sub-cell detail to report.
 *
 * `scale` multiplies both axes, which is what makes the stroke 2 cells wide at scale 2: the target's
 * banner strokes measure 1 to 2 cells and its ground-field letters 1.
 */
export function rasterizePhrase(
  glyphs: readonly string[], scale: number, axis: 'h' | 'v',
): Stencil | null {
  const drawings = glyphs.map((key) => GLYPHS[key]).filter((rows): rows is readonly string[] => !!rows);
  if (drawings.length !== glyphs.length || drawings.length === 0 || scale < 1) return null;
  const sizes = drawings.map((rows) => ({ w: (rows[0]?.length ?? 0) * scale, h: rows.length * scale }));
  // One cell of air per unit of scale, so the letters of a doubled phrase do not touch.
  const gap = scale;
  const across = Math.max(...sizes.map((s) => (axis === 'h' ? s.h : s.w)));
  const along = sizes.reduce((a, s) => a + (axis === 'h' ? s.w : s.h), 0) + gap * (sizes.length - 1);
  const width = axis === 'h' ? along : across;
  const height = axis === 'h' ? across : along;

  const coverage = new Uint8Array(width * height);
  let cursor = 0;
  for (const [k, rows] of drawings.entries()) {
    const size = sizes[k]!;
    // Centred on the cross axis, so a figure taller than the letters beside it sits on their middle
    // rather than on their baseline.
    const offX = axis === 'h' ? cursor : Math.floor((width - size.w) / 2);
    const offY = axis === 'h' ? Math.floor((height - size.h) / 2) : cursor;
    for (let y = 0; y < size.h; y++) {
      const row = rows[Math.floor(y / scale)]!;
      for (let x = 0; x < size.w; x++) {
        if (row[Math.floor(x / scale)] !== '#') continue;
        coverage[(offY + y) * width + offX + x] = 255;
      }
    }
    cursor += (axis === 'h' ? size.w : size.h) + gap;
  }
  const quad = new Uint8Array(width * height * 4);
  for (let i = 0; i < coverage.length; i++) {
    const v = coverage[i]!;
    quad[i * 4] = v; quad[i * 4 + 1] = v; quad[i * 4 + 2] = v; quad[i * 4 + 3] = v;
  }
  return { width, height, coverage, color: new Uint32Array(width * height), quad };
}

// --- what a landmark is ----------------------------------------------------------------------------

export type LandmarkKind = 'wall-banner' | 'ground-field' | 'terrace-court';

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

export interface LandmarkInput {
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
  /** The 文字/图案景观 region the list drew, where the list drew one: a ground field lands where the
   *  plan wanted one. Absent, a field is pulled toward the plaza like a court. */
  region?: RegionPlan;
  seed: number;
  richness: number;
}

// --- tunables ------------------------------------------------------------------------------------

/** Cells of water between the glyph and the panel's own edge. The target's banner is 14 rows deep
 *  around a 12-row phrase; its ground field is far roomier than its letters. */
const BANNER_PAD = 1;
const FIELD_PAD = 2;
/** Cell scales tried, largest first: scale 2 draws the target's banner (letters 10x12, strokes 2
 *  cells), scale 1 its ground field (letters 5x6, strokes 1). */
const SCALES = [2, 1] as const;
/**
 * The FIELD's own scales, and it is offered one more than the banner.
 *
 * A field's ink is ground left standing rather than a wall stroke, so a fat letter reads as a platform
 * in a pool and not as a thick line — and the scale is what lets a TEXT form answer the big rung at
 * all: at scale 2 a lone figure fills 18x18 and the reference-scale rung asks for 600 cells, so the
 * court answered every island that could carry one. Measured, scale 3 puts a field at 25x25 to 74x24.
 */
const FIELD_SCALES = [3, 2, 1] as const;
/** The lowest wall tier worth writing a banner on. Below this the plateau is a rise, not a wall, and
 *  a phrase across it does not read as a signboard. */
const BANNER_MIN_TIER = 2;
/** Open ground a GROUND-LEVEL field keeps around itself. Same reading as the channel's own keep: what
 *  a body of water leaves beside it must still be a road's width of ground, or the water and the lots
 *  beyond it are one wall across the network. A raised field is tested by its ring instead. */
const FIELD_KEEP = 2;
/**
 * How often a map builds a landmark BELOW `SET_PIECE_FROM`, at richness 0 and that threshold.
 *
 * A quiet island is a garden town and a set piece written across it is not what the axis is for, so
 * down there 文字/图案景观 stays OCCASIONAL. At and above the threshold the roll is gone: the map is
 * required to carry one figure, per the size ladder below.
 */
const OCCURRENCE = { min: 0.4, max: 0.6 } as const;
/**
 * THE RICHNESS FROM WHICH AN ISLAND MUST CARRY ITS ONE FIGURE, and how large that figure is.
 *
 * THE RULE IS THAT A COMPOSITION HAS A PRIMARY SET PIECE and ordinary ground for the rest. Without one a
 * map is an even field of interchangeable blocks — one building per block, one pond per block, at one
 * level, nothing occurring once — where the reference carries one unmistakable large form running right
 * beside the path network.
 *
 * TWO SIZES, because the ground and the ambition do not always agree. `SET_PIECE_WANT` is the floor for a
 * composed figure (300 cells; the reference's own two are 772 and 330) and it is what a figure is drawn at
 * wherever the island offers the room. `SET_PIECE_MIN` is the smallest panel the pass will still call a
 * figure, and it is MEASURED rather than chosen: on the tightest seeds the largest clear one-tier panel
 * with a legal ring is 120 to 240 cells, because the streets, the lots and their doorsteps are reserved
 * before this runs. So a figure is asked for at the wanted size on every tier first, and only then at
 * whatever the best ground can carry.
 */
const SET_PIECE_FROM = 0.5;
export const SET_PIECE_WANT = 300;
export const SET_PIECE_MIN = 120;
/**
 * THE ONE BIG THING: the panel a full-richness island is asked for FIRST, and the shape of the ask.
 *
 * WHAT THE NUMBER ANSWERS is hierarchy: the reference maps carry a one-off centerpiece clearly
 * larger and more elaborate than anything else, where modest scattered ponds of similar size read
 * as no centerpiece at all. Measured on ten full-richness seeds of both
 * templates, the biggest composed figure read 118 to 524 water cells against the terraced reference's
 * 1010 and the garden town's 1427 — and the panel that carried it was drawn at one of `COURT_SIZES`,
 * whose largest entry is 544 cells before the pattern takes its share.
 *
 * So the ask is the TERRACE FLOOR rather than a size from a list: `floorPanel` reads the largest
 * rectangle the tier's own clear ground can hold and offers THAT, which is how a figure comes out at
 * the scale of the ground it stands on instead of at a scale chosen in advance. Measured over six
 * seeds, the largest such rectangle runs 495 to 817 cells, so the rung is set where most islands can
 * answer it and the ladder falls back to the smaller rungs where one cannot.
 *
 * The aspect cap is what keeps a 4-cell-wide sliver 200 cells long from winning on area alone, and the
 * area cap is what keeps the figure from eating a whole terrace the streets need.
 */
export const SET_PIECE_BIG = 600;
const COURT_ASPECT_MAX = 7;
const COURT_AREA_MAX = 1100;
/**
 * The calm band around a figure, in cells, and the sizes a summit court is tried at.
 *
 * FRAMING IS WHAT MAKES A FIGURE READ AS ONE. The reference's banner is framed on four sides by a road
 * border 3 rows deep with 4-cell jambs, and that border is the whole difference between a signboard and a
 * lake. Ours is reserved as calm ground the moment the panel lands and paved by the pipeline where it can
 * join the network.
 *
 * The court sizes are the room a real island offers: the largest SQUARE of unreserved one-tier ground
 * measures about thirteen cells, with long rooms of 20 to 39 common, so a court is drawn as
 * a long panel rather than as a square one. They are tried largest AREA first, so a tier answers with
 * the biggest panel it can carry rather than with the first aspect that happens to fit.
 */
const FRAME_PAD = 3;
const COURT_SIZES: readonly { w: number; h: number }[] = [
  { w: 34, h: 16 }, { w: 30, h: 14 }, { w: 40, h: 10 }, { w: 46, h: 8 }, { w: 26, h: 14 },
  { w: 52, h: 7 }, { w: 60, h: 6 }, { w: 24, h: 13 }, { w: 22, h: 14 }, { w: 26, h: 10 },
  { w: 30, h: 8 }, { w: 20, h: 12 }, { w: 34, h: 7 }, { w: 26, h: 7 }, { w: 18, h: 10 },
  { w: 22, h: 8 }, { w: 16, h: 9 }, { w: 20, h: 7 }, { w: 14, h: 9 }, { w: 12, h: 10 },
];

// --- the entry points --------------------------------------------------------------------------------

/** The 文字/图案景观 region, where the region list drew one. Its presence is the FIRST of the three
 *  gates a landmark passes: `region-list.ts` holds the theme at `minRichness`, so a map below that
 *  richness never carries one. The other two are `OCCURRENCE` and finding a panel at all. */
export function landmarkRegion(plan: DesignPlan): RegionPlan | null {
  return plan.regions.find((r) => r.themeId === 'landmark-text') ?? null;
}

/**
 * Write the map's ONE FIGURE, or nothing where no form fits anywhere legal.
 *
 * The three placements are tried in a seeded order and the phrase is drawn from the bank, but no
 * choice can force a shape onto ground that will not carry it: a panel is only taken where the whole
 * of it plus its surrounding ring already stands as the construction needs, so a landmark that would
 * ship mangled is simply not built.
 *
 * ONE PER ISLAND, NEVER TWO: the pass returns at the first form that lands, and the size floor is
 * what keeps the one it returns the map's biggest composed thing rather than another ornament.
 */
export function carveLandmark(input: LandmarkInput): LandmarkPlan | null {
  const rng = makeRng((input.seed ^ 0x1a4d3a2c) >>> 0);
  const r = input.richness < 0 ? 0 : input.richness > 1 ? 1 : input.richness;
  if (r < SET_PIECE_FROM
    && rng.float() >= OCCURRENCE.min + (OCCURRENCE.max - OCCURRENCE.min) * r) return null;
  // The floor binds where a figure is REQUIRED. Below that a landmark is an occasional ornament and
  // the ground a quiet island offers is smaller, so a small one is better than none.
  const floor = r >= SET_PIECE_FROM ? SET_PIECE_MIN : 0;

  // The drawn phrase leads and the rest of the bank follows it, so a map that cannot carry HOME
  // anywhere writes something rather than nothing.
  const wanted = drawPhrase(rng);
  const phrases = [wanted, ...PHRASE_BANK.filter((p) => p !== wanted)];
  // The WALL is the target's own placement and the ground field is the cheap version of it (the
  // garden town's), so the banner is asked first on two maps in three. The COURT is asked last and is
  // the form that does not depend on a phrase fitting: a flooded terrace with a pattern standing in
  // it, which is what an island with room for the figure but not for the words gets.
  const pattern = COURT_PATTERNS[rng.int(COURT_PATTERNS.length)]!;
  const courts = courtSearches(input);
  const banners = bannerSearches(input);
  const fields = fieldSearches(input);
  // THE FAMILY IS A CHOICE, NOT A CONSEQUENCE OF WHICH ONE COULD ANSWER THE LARGEST RUNG.
  //
  // Rung-major over all three forms makes the court the answer on TWENTY of twenty maps: no phrase panel
  // reaches the big rung on ordinary ground, the court's terrace floor usually does, and the loop returns
  // there before a banner is ever asked at the rung below — one form on every island, which reads as
  // predefined whatever it is. So a seed DRAWS its family, that family is offered every rung down to the
  // floor, and only a family the island cannot carry anywhere hands the map to the other two.
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
  // THE FALLBACK IS RUNG-MAJOR, since here the question is no longer which form the map wanted but
  // whether it can carry one at all: the biggest panel any remaining form offers is the right answer.
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
 * The wall banner is the style target's own set piece and the ground field is the garden town's, so the
 * two TEXT forms carry most of the weight between them; the court is the form that depends on no phrase
 * fitting, which makes it both the most reliable and — left to win by reliability alone — the one that
 * turns up on every island.
 */
const KIND_WEIGHTS: ReadonlyArray<{ kind: LandmarkKind; low: number; high: number }> = [
  { kind: 'wall-banner', low: 0.5, high: 3 },
  { kind: 'ground-field', low: 1, high: 3 },
  { kind: 'terrace-court', low: 4, high: 3 },
];

/**
 * The family this seed sets out to build, drawn by weight against richness.
 *
 * THE QUIET END LEANS ON THE COURT, and that is the arrival rule rather than taste: a flat garden town
 * carries no cascade and few composed bodies, so its court is the one thing on it built to be arrived
 * at, and the two text forms both want a large clear panel a low-relief island rarely has. Drawn evenly
 * down there, `tafa/1024` at richness 0.2 comes back with 4 of its 14 street ends arriving at nothing.
 * At full richness the three are even, so no one form is the island's answer twice over.
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

/** The cells a landmark claims, panel and FRAME: what the decoration pass must leave alone. A plant
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
 * A panel's INSIDE must be untouched wall standing at exactly the panel's tier, and the ring around
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
 * would be rebuilt on every call — the bank calls once per phrase and the size ladder calls twice, up to
 * ten times for the banner alone, measured at about 600 ms of the second on `hexia/12345` at
 * richness 0.5.
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
        // A panel's INSIDE must be untouched wall standing at exactly the panel's tier, and the ring
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
  // A FIELD IS A BANNER WRITTEN OFF THE WALL, so it is asked of every tier and not of elevation 0
  // alone. At full richness the relief floor leaves an island with almost no ground AT 0: asked of
  // elevation 0 alone the form lands on none of twenty maps and the court answers every one of them,
  // which is one form on every island again. The legality argument is the
  // banner's, unchanged: water at the panel's tier with its ring at that tier or above shows no face,
  // and a letter left standing at the same tier keeps the 3x3 window it had before the flood.
  // A RAISED FIELD IS A TERRACED-ISLAND FORM. Below the set-piece richness the map is a garden town and
  // the ground field is its own ground-level version, exactly as the reference garden town draws it;
  // offering the raised variant down there put a panel on ground `tafa/1024` at richness 0.2 needed for
  // its street ends, which the arrival rule reads as four ends arriving at nothing.
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
          // The open-ground KEEP is the ground-level form's own: at 0 a field is cut into the town's
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
 * The lot itself is rarely big enough — the reference's field is 18x28 against a 21x15 lot — so the
 * search takes the whole map and is only PULLED toward the lot, which is what puts the field on the
 * town's flank the way the target's is. It is tried at the roomiest clearance first, so a field
 * lands in genuinely open ground where the map has any.
 */
function planField(phrase: Phrase, cache: TierSearches): Found | null {
  // SIZE BEFORE ROOM. The target's field is 18x28 around 5x6 letters, so a landmark drawn small in the
  // roomiest pocket is further from it than one drawn full size in a tighter one.
  for (const scale of FIELD_SCALES) {
    // Down the y axis first: the target's field is read side-on from the plaza, so its letters stack
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
    // THE TIER IS ASKED ONE QUESTION FIRST. A tier whose largest inscribable rectangle is smaller than
    // the floor cannot answer any size in the ladder, and its own mask is cheaper to measure than one
    // position sweep.
    const search = cache.at(tier);
    if (!search) continue;
    // THE TERRACE FLOOR LEADS, and the list is what a tier too small for it falls back to.
    const sizes = [...floorPanel(search), ...COURT_SIZES];
    for (const size of sizes) {
      for (const [w, h] of [[size.w, size.h], [size.h, size.w]] as const) {
        if (w * h < floor || !canHold(search, w, h)) continue;
        const panel = findPanel(search, w, h);
        if (!panel) continue;
        // THE PATTERN STANDS IN THE MIDDLE OF THE WATER, and how far in scales with the panel: the
        // reference's banner is 130 cells of ink inside 772 of water, so a figure drawn to the edge of
        // a reference-scale panel is a paved terrace with a moat rather than one big composed body.
        const pad = courtPad(w, h);
        // A PATTERN THE PANEL CANNOT CARRY IS NOT DRAWN THIN, it is exchanged for the one every panel
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
 * TERRACE FLOOR offered as a panel size, or nothing where the tier holds no room worth the name.
 *
 * Each width is offered twice — the tallest rectangle that fits at all, and the same TRIMMED to the
 * aspect cap, since a room 6 cells wide and 60 tall holds no panel this pass may take but holds a 6x42
 * one it may. (Written as a rounding of the WIDTH to a multiple of the cap, which is what the first cut
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
      // A panel over the area cap is trimmed on BOTH axes by the square root of the overshoot, so it
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

/**
 * The patterns a court's dry mass can be drawn as, and the whole of the court's vocabulary.
 *
 * ONE FORM REPEATED IS THE TELL: a map whose water is 85% to 95% one stamped rectangle reads as
 * wallpaper, and a figure pass answering every island with the same medallion would put that fault back
 * at set-piece scale. So a court draws its pattern from this bank by seed, and every entry is
 * symmetric in both axes — nothing about the drawing depends on which way round the panel was found.
 */
export const COURT_PATTERNS = ['medallion', 'rings', 'bars', 'islets', 'cross'] as const;
export type CourtPattern = (typeof COURT_PATTERNS)[number];

/** How many cells of a stencil carry ink. */
const inkOf = (s: Stencil): number => s.coverage.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);

/** The least mass a court's pattern may draw. Under this the panel reads as a pool rather than as a
 *  figure, and the pattern the seed drew is not one this panel can carry. */
const COURT_INK_MIN = 9;

/** How many nested rectangles the `rings` pattern draws, and how often a `bars` tooth stands. */
const RING_BANDS = 3;
const BAR_PITCH = 4;

/** The court's pattern as a stencil: the strokes are what stands dry inside the flooded panel. */
export function courtInk(width: number, height: number, pattern: CourtPattern): Stencil {
  const w = Math.max(1, width), h = Math.max(1, height);
  const coverage = new Uint8Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const block = Math.max(1, Math.round(Math.min(w, h) / 6));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Distance measured on the SHORTER axis's scale in both, so a long panel carries the figure at
      // its own proportions rather than one stretched to the ends.
      const dx = Math.abs(x - cx) * (h / w), dy = Math.abs(y - cy);
      const corner = (x < block || x >= w - block) && (y < block || y >= h - block);
      // THE RINGS ARE NORMALIZED TO THE PANEL, not counted in from its edge. `min(x, w-1-x, y, h-1-y)`
      // is the distance to the nearest side, so on the long panels a real island most often offers
      // (46x8, 52x7, 60x6) it never passes 3 and the pattern came out as one or two lines running the
      // whole width — a stripe. Scaled to each axis's own half-span it draws `RING_BANDS` nested
      // rectangles at any aspect, which is the figure the name promises.
      const ring = Math.round(RING_BANDS * Math.max(
        Math.abs(x - cx) / Math.max(1, cx), Math.abs(y - cy) / Math.max(1, cy),
      ));
      // AND THE BARS RUN ACROSS THE LONG AXIS WITH A SPINE DOWN IT. Drawn as `x % 3` they are parallel
      // lines whichever way the panel lies, the same silhouette as the rings — two of the bank's five
      // entries reading as one. Across the long axis with a spine they are a comb, a shape of its own and
      // the one the reference's water gardens carry.
      const alongX = w >= h;
      const teeth = (alongX ? x : y) % BAR_PITCH === 1;
      const spine = alongX ? Math.abs(y - cy) <= block : Math.abs(x - cx) <= block;
      let ink = false;
      switch (pattern) {
        case 'medallion': ink = dx + dy <= Math.max(2, Math.min(w, h) / 2 - 1) / 2 || corner; break;
        case 'rings': ink = ring % 2 === 1; break;
        case 'bars': ink = teeth || spine; break;
        case 'islets': ink = x % 5 < 2 && y % 4 < 2; break;
        case 'cross': ink = Math.abs(x - cx) <= block || Math.abs(y - cy) <= block || corner; break;
      }
      if (ink) coverage[y * w + x] = 255;
    }
  }
  const quad = new Uint8Array(w * h * 4);
  for (let i = 0; i < coverage.length; i++) {
    const v = coverage[i]!;
    quad[i * 4] = v; quad[i * 4 + 1] = v; quad[i * 4 + 2] = v; quad[i * 4 + 3] = v;
  }
  return { width: w, height: h, coverage, color: new Uint32Array(w * h), quad };
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

// --- finding a rectangle ---------------------------------------------------------------------------------

interface PanelSearch {
  W: number; H: number;
  area: Rect;
  toward: { x: number; y: number };
  /** Summed area over the cells the panel's inside may take. */
  inside: Int32Array;
  /** Summed area over the cells its surrounding ring must satisfy; absent leaves the ring free. */
  ring?: Int32Array;
  /**
   * The tallest rectangle of each WIDTH that fits inside the mask at all, indexed by width, and the whole
   * point of it is to be asked BEFORE a position scan: `findPanel` sweeps every position of the map, and
   * the size ladder asks about twenty sizes in two orientations against every tier. An AREA bound is not
   * enough — a tier holding thousands of open cells in awkward shapes passes it for every size and then
   * pays the sweep — so the profile answers each (w, h) exactly.
   */
  profile: Int32Array;
}

/** The panel of `w` x `h` closest to `toward` whose inside and ring both hold, or null. Positions
 *  are compared by Manhattan distance from `toward` and ties go to the first in scan order, so the
 *  answer is a function of the terrain rather than of the order candidates were reached in. */
function findPanel(s: PanelSearch, w: number, h: number): Rect | null {
  if (w > s.area.w || h > s.area.h) return null;
  let best: Rect | null = null;
  let bestD = Infinity;
  for (let y = s.area.y; y + h <= s.area.y + s.area.h; y++) {
    for (let x = s.area.x; x + w <= s.area.x + s.area.w; x++) {
      const rect = { x, y, w, h };
      if (rectSum(s.inside, s.W, rect) !== w * h) continue;
      if (s.ring) {
        const round = { x: x - 1, y: y - 1, w: w + 2, h: h + 2 };
        if (round.x < 0 || round.y < 0 || round.x + round.w > s.W || round.y + round.h > s.H) continue;
        if (rectSum(s.ring, s.W, round) !== round.w * round.h) continue;
      }
      const d = Math.abs(x + w / 2 - s.toward.x) + Math.abs(y + h / 2 - s.toward.y);
      if (d < bestD) { bestD = d; best = rect; }
    }
  }
  return best;
}

/**
 * The tallest all-inside rectangle of each width, indexed by width: `profile[w]` is the greatest `h` for
 * which some `w` x `h` rectangle fits wholly inside the mask, and 0 where none does.
 *
 * The standard histogram sweep — per row, the run of set cells above each column, then every MAXIMAL
 * rectangle in that histogram off one stack — and a suffix pass at the end, since a rectangle `w` wide
 * and `h` tall means one `w - 1` wide is at least as tall. O(W x H) once per tier, against a sweep of
 * every position per size asked.
 */
function rectProfile(mask: Uint8Array, W: number, area: Rect): Int32Array {
  const heights = new Int32Array(area.w);
  const best = new Int32Array(area.w + 2);
  const stack: number[] = [];
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let c = 0; c < area.w; c++) {
      heights[c] = mask[flatIndex(area.x + c, y, W)] ? heights[c]! + 1 : 0;
    }
    stack.length = 0;
    for (let c = 0; c <= area.w; c++) {
      const h = c === area.w ? 0 : heights[c]!;
      while (stack.length && heights[stack[stack.length - 1]!]! >= h) {
        const top = stack.pop()!;
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
        const width = c - left;
        if (heights[top]! > best[width]!) best[width] = heights[top]!;
      }
      stack.push(c);
    }
  }
  for (let w = area.w - 1; w >= 1; w--) if (best[w + 1]! > best[w]!) best[w] = best[w + 1]!;
  return best;
}

/** Whether a `w` x `h` panel fits anywhere inside the search's mask, read off its profile. */
const canHold = (s: PanelSearch, w: number, h: number): boolean =>
  w <= s.area.w && h <= s.area.h && (s.profile[w] ?? 0) >= h;

/** Prefix sums over a 0/1 mask, `(W+1) x (H+1)`, so any rectangle's count is four reads. */
function summedArea(mask: Uint8Array, W: number, H: number): Int32Array {
  const stride = W + 1;
  const out = new Int32Array(stride * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += mask[flatIndex(x, y, W)]!;
      out[(y + 1) * stride + x + 1] = out[y * stride + x + 1]! + row;
    }
  }
  return out;
}

function rectSum(sat: Int32Array, W: number, r: Rect): number {
  const stride = W + 1;
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  return sat[y1 * stride + x1]! - sat[y0 * stride + x1]! - sat[y1 * stride + x0]! + sat[y0 * stride + x0]!;
}

function clipRect(r: Rect, W: number, H: number): Rect | null {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  const x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
