/**
 * THE CASCADE STAIR: one water composition stacked down a flank of the mass, band over band.
 *
 * The style target's clearest water figure is a terraced cascade: seven stacked bands, one per terrace,
 * each 2 to 4 rows deep and 30 to 40 cells wide, separated by 1 to 3 rows of mountain, one composition
 * accounting for a large share of the island's 780 capped-face cells. Half that map's bodies present a
 * capped face and a quarter span terraces, so its water is a VERTICAL system, and a stair is the form
 * that says so from inside the map: a visitor at the foot sees every tier at once.
 *
 * The stair is a STRIP walked down the fall line, and each of the terrace steps it meets is cut as a
 * BAND with its landing. THE WHOLE OF IT IS ONE CONNECTED BODY: the crossing between one band's landing
 * and the next band is flooded too, and a crossing the ground does not offer ENDS the stair rather than
 * letting it carry on past a dry terrace. A SPLIT STAIR IS INVISIBLE: a stair cut as two 2-tier pools
 * reads as two ordinary ponds, and bands allowed to stand apart arrive as one body on 0 of 16 hexia
 * stairs and 1 of 14 tafa ones, which puts the figure the pass exists to draw on no map at all. Held
 * connected, both templates read a stair on 10 seeds of 10, every one a single body. The
 * 1-to-3-rows-of-mountain separation between the target's own bands is the RISER between two terraces,
 * which the landing row already crosses; a whole dry terrace between two pools is a different thing.
 *
 * WHAT THE GROUND GIVES, THE STAIR TAKES. A designed island's terrace FLOORS carry its streets, its lots
 * and their doorsteps, so a rigid strip has to find its whole width free on every row of a descent and
 * almost never does: it reaches a second band on 12 attempts of 5127 over twenty measured maps. Three
 * things answer that, and together they cut a stair on every seed of both templates — the band takes the
 * widest CAPPED RUN inside the band above it rather than one fixed width, the CROSSING between two
 * treads may be narrower still (`CHUTE_MIN`), and the floor on a band's width is five cells, not seven.
 *
 * LEGAL BY CONSTRUCTION, band by band, on the same two arguments the rest of the water is cut by:
 *  - a REACH row shows no face — its flanks and the row ahead of it stand at its own level or above —
 *    so V-WTR-02 asks it for no caps (`cellsFit`).
 *  - a BAND's front row is the one place a face is wanted. Its two flanks are mountain at EXACTLY the
 *    band's tier, which is the cap V-WTR-02 names, and `traceToMountain` walks the whole strip through
 *    same-level water to reach them, so one cap at each end serves a band of any width. The row it
 *    pours onto, caps included, is read for uniformity first (V-WTR-03) and then flooded at its own
 *    level, so the fall arrives in water rather than on a shelf.
 *  - EVERY ATTEMPT IS TRANSACTIONAL, like the story's: a strip that runs out of steps is put back cell
 *    for cell and the next candidate is tried.
 *
 * Pure over its inputs (a `TerrainPlan` and two masks): no state, no rules consulted, no browser API,
 * and the same plan cuts the same stairs — nothing here is seeded, the lips are ranked by the ground
 * itself and the first strip that descends is the stair.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import type { MacroCoord, Rect } from '../../../../core/model/types';
import type { TerrainPlan } from '../../core/types';
import type { MovementLine, WaterWant } from '../composition/movement-line';
import { boundsOfCells, cellsFit, floodCells, freeAt, surfaceOf, uniform } from './water-cut';

// --- tunables, measured off the two reference maps -----------------------------------------------

/** How wide the strip runs, at richness 0 and 1, and the narrowest a band may be. The style target's
 *  bands read 30 to 40 cells; a narrower one still reads as a stair, and every band takes the widest run
 *  its row offers, so the floor is what a crowded flank may fall back to rather than a width anything is
 *  drawn at by preference. FIVE, not seven: over twenty measured maps a seven-cell floor refuses 40608
 *  of the rows where the ground actually steps down, and only 2 of 10 and 4 of 10 maps then carry a
 *  stair at all. */
// The widest ask is where the reference's own treads read, and the ground can only answer it while a
// terrace's runs are wider than the ask: the places a map lays leave runs of 49 to 79 cells, where
// terraces cut into runs of 28 to 42 offer no row to stand on.
const STAIR_WIDTH = { min: 5, max: 40 } as const;
/** How many starting widths are tried at one lip, so a blocked flank is not answered thirty times. */
const WIDTH_TRIES = 5;
/** How deep one band is: the target's bands read 2 to 4 rows, and these are the depths drawn at richness
 *  0 and 1. `min` is also the FLOOR every band is held to — a single row of water across a terrace is a
 *  line, not a band, and unenforced the floor leaves 18 of 38 bands one row deep. */
const BAND_DEPTH = { min: 2, max: 3 } as const;
/** How many rows of terrace the stair carries water across between two steps. Past this the terrace
 *  is a FLOOR rather than a riser, and the stair ENDS at the band it has reached rather than starting
 *  again on the far side: what stands on the far side of a whole dry terrace is a second pool, not the
 *  next tread of one figure. Flooding a crossing of any length instead would spend a map's entire
 *  water budget on one plate, and spend it on a rectangle framed by mountain. */
const STAIR_JOIN = 12;
/** How far apart two steps may stand and still belong to one stair, in rows. Past this the strip has
 *  left the flank and is crossing a plate, and two bands that far apart read as two features rather
 *  than as one figure — the target's own cascade spans 21 rows for seven bands. */
const STAIR_RUN_MAX = 28;
/** The fewest steps a strip must descend before it is a stair rather than a pool on a lip, and the
 *  most it may cut: the style target's own cascade has seven. */
const STEPS_MIN = 3;
const STEPS_MAX = 7;
/** How many stairs one island carries, at richness 0 and 1. Two is the most the shape vocabulary
 *  allows before a second stair reads as a repeat of the first. */
const STAIR_COUNT = { min: 1, max: 2 } as const;
/** How far apart two stairs stand, and how many lips are tried before the mass is left dry. A hundred
 *  and twenty, because a whole clear descent is scarce and the lips that offer one are not the tallest:
 *  at forty tries only 5 of 10 and 8 of 10 maps carry a stair, at a hundred and twenty every one does,
 *  and a refused lip costs one strip walk. */
const STAIR_GAP = 26;
const STAIR_TRIES = 120;
/** The lowest tier a stair may START from: a stair wants tiers to fall down, and a strip beginning
 *  one step above the ground floor is a single fall. */
const STAIR_FROM_TIER = 2;
/** How far the walk pulls a stair toward itself, in cells: the cascade a visitor climbs beside is
 *  worth more than the same stair on the far flank. */
const WALK_PULL = 30;
/** The narrowest a CROSSING may run, in cells: the width of the trough the shape vocabulary draws, since
 *  a channel thinner than that reads as a scratch rather than as the water joining two treads. */
const CHUTE_MIN = 3;

// --- what a stair is ----------------------------------------------------------------------------

/** One band of the stair: the water standing on one terrace step, and the tier it pours from. */
export interface StairBand {
  rect: Rect;
  tier: number;
  /** The level this band pours onto: one tier down for a step, further for a plunge. */
  landsAt: number;
}

export interface CascadeStair {
  bands: StairBand[];
  /** Every cell the stair flooded, bands, landings and reaches together. */
  cells: MacroCoord[];
  /** The middle of the top band: where the composition begins. */
  head: MacroCoord;
  /** The middle of the last landing, and the level it stands at: the mouth the island's water story
   *  carries on from, so the stair and the course read as one system. */
  foot: MacroCoord;
  footTier: number;
  /** How many distinct tiers the stair crosses, top band to last landing. */
  tiers: number;
  width: number;
}

export interface StairInput {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  richness: number;
  /** The walk, so a stair stands on the flank a visitor climbs where the ground offers one there. */
  line?: MovementLine | undefined;
}

type Vec = readonly [number, number];

const DIRS: readonly Vec[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const perp = (d: Vec): Vec => [d[1], -d[0]];

// --- cutting them -------------------------------------------------------------------------------

/**
 * The island's cascade stairs, cut into the sculpt.
 *
 * Candidates are LIPS — a cell of high ground whose neighbour one way stands lower — taken in order of
 * how tall they are and how near the walk passes, with the cascade bands the movement line asked for
 * by name first. Each is offered the widths from widest down, and the first strip that descends
 * `STEPS_MIN` steps is the stair.
 *
 * The candidate is a lip rather than a patch of high ground because that is where a band can be cut at
 * all: a strip started in the middle of a plate walks the plate's own width before it meets a step,
 * and measured on real designed ground it spent its whole run doing that and cut nothing.
 */
export function carveCascadeStairs(input: StairInput): CascadeStair[] {
  const { richness } = input;
  const budget = Math.round(lerp(STAIR_COUNT.min, STAIR_COUNT.max, richness));
  const depth = Math.round(lerp(BAND_DEPTH.min, BAND_DEPTH.max, richness));
  const widest = Math.round(lerp(STAIR_WIDTH.min, STAIR_WIDTH.max, richness));
  const out: CascadeStair[] = [];
  const found = lips(input);
  // THREE STEPS FIRST, TWO AS A FALLBACK. A stair wants a run of terrace steps clear of the streets, the
  // buildings and their doorsteps, and on some islands no flank offers three of them: measured over
  // twenty gate runs, asking for three alone left five maps of ten on `hexia` with no cascade at all. A
  // two-step stair still stacks bands over three tiers, which is the form; it is simply the smallest one.
  for (const steps of [STEPS_MIN, STEPS_MIN - 1]) {
    for (const lip of found) {
      if (out.length >= budget) break;
      if (out.some((s) => Math.abs(s.head.x - lip.at.x) + Math.abs(s.head.y - lip.at.y) < STAIR_GAP)) continue;
      const stair = tryStair(input, lip, widest, depth, steps);
      if (stair) out.push(stair);
    }
    if (out.length > 0) break;
  }
  return out;
}

/**
 * Every starting width offered at one lip, transactionally: what a refused attempt cut is put back
 * before the next is tried.
 *
 * The width a strip starts with is the WINDOW its first band is drawn inside, not the width it is drawn
 * at — the band takes the widest capped run the window holds. A narrower window is still worth offering,
 * because every band below stands inside the one above: a first band that takes a whole terrace can leave
 * the descent nowhere to go, where a narrower one follows the flank down.
 */
function tryStair(
  input: StairInput, lip: Lip, widest: number, depth: number, steps: number,
): CascadeStair | null {
  const { t } = input;
  // No wider than the lip's own run, less the cell at each end a band caps itself with.
  const top = Math.min(widest, lip.run - 2);
  for (let k = 0; k < WIDTH_TRIES; k++) {
    const width = Math.max(STAIR_WIDTH.min,
      Math.round(top - (k * (top - STAIR_WIDTH.min)) / Math.max(1, WIDTH_TRIES - 1)));
    const snapTier = t.tier.slice(), snapWater = t.water.slice();
    const stair = runStair(input, lip.at, lip.dir, width, depth, steps);
    if (stair) return stair;
    t.tier.set(snapTier);
    t.water.set(snapWater);
  }
  return null;
}

/**
 * One strip walked down the fall line from `start`, or null where it found fewer than `steps` steps to
 * descend.
 *
 * `start` is the middle of the lip the stair begins on, so the first band is cut where the candidate
 * said the ground steps. After each band the NEXT step is SEARCHED FOR rather than walked to: the rows
 * between two steps are asked for nothing beyond being floodable, and only the band's own rows and its
 * landing have to be clean. Measured on real designed ground, requiring an unbroken strip all the way
 * down stopped 124 of 126 attempts one band in — a plate boundary wobbles, so the row below a step is
 * part lower terrace and part step.
 *
 * THE STRIP NARROWS AS IT FALLS, and that is what lets a stair be cut on a built island at all. A band
 * takes the widest CAPPED RUN of free ground it finds inside the band above it, so a doorstep or a street
 * reaching into the flank costs the stair the cells it covers rather than the whole descent. The bands
 * still stack about one axis and each stands inside the one above, so the whole of it reads as one figure
 * — a cascade that gathers as it falls, which is what water does.
 *
 * The crossing between two steps IS flooded (`joinRows`), so the whole stair is one connected body; a
 * crossing too long or too broken to flood ENDS the stair, since what stands on the far side of a dry
 * terrace is a second pool rather than the next tread of one figure.
 */
function runStair(
  input: StairInput, start: MacroCoord, dir: Vec, width: number, depth: number, steps: number,
): CascadeStair | null {
  const { t, grass, flat } = input;
  const p = perp(dir);
  const half = (width - 1) >> 1;
  const at = (row: MacroCoord, k: number): MacroCoord => ({ x: row.x + p[0] * k, y: row.y + p[1] * k });
  const rowOf = (row: MacroCoord, span: Span): MacroCoord[] => {
    const out: MacroCoord[] = [];
    for (let k = span.lo; k <= span.hi; k++) out.push(at(row, k));
    return out;
  };
  const mine = new Set<number>();
  // The stair's OWN water counts as ground for the strip, but only where it stands at the level being
  // asked about: a cell of the band above is this stair's water at a higher tier, and taking it into a
  // lower band would flood it a second time and leave the band above uncapped.
  const free = (c: MacroCoord, tier: number): boolean => {
    const i = flatIndex(c.x, c.y, t.width);
    return (mine.has(i) && t.water[i] === tier) || freeAt(t, grass, flat, c.x, c.y, tier);
  };
  let tier = surfaceOf(t, start.x, start.y);
  let span: Span = { lo: -half, hi: width - 1 - half };
  if (tier < STAIR_FROM_TIER) return null;

  const bands: StairBand[] = [];
  const cells: MacroCoord[] = [];
  const tiers = new Set<number>([tier]);
  let head: MacroCoord | null = null;
  let foot = middleOf(rowOf(start, span));
  let top = 0;
  // Where the search for the next step starts: the lip to begin with, then each landing in turn.
  let from = start;
  let landed: MacroCoord | null = null;

  for (let step = 0; step < STEPS_MAX; step++) {
    let cut: Band | null = null;
    let atRow: MacroCoord | null = null;
    for (let k = 0; k <= STAIR_RUN_MAX && !cut; k++) {
      const row = { x: from.x + dir[0] * k, y: from.y + dir[1] * k };
      cut = cutBand({ input, free, at, rowOf, row, dir, span, tier, depth });
      if (cut) atRow = row;
    }
    if (!cut || !atRow) break;
    // THE REACH IS WHAT MAKES THE STAIR ONE BODY, and it is measured against the band's OWN depth: a
    // band that came out shallower than the depth asked for reaches further back than the crossing
    // does, and filling to the depth asked for left the rows between them dry — which is how a stair
    // reached the map as two separate pools.
    const reach = joinRows({ input, free, at, rowOf, landed, atRow, dir, cut, tier });
    if (reach === null) break;
    // THE TREAD IS WHAT THE DEPTH FLOOR IS READ ON: every row of water standing at this tier, the
    // crossing that carried the fall from above included, since that row is where the water arrived and
    // it is the same sheet the next face pours off. What the ground lets the strip cut BEHIND a face is
    // often one row on a built terrace; what a visitor sees at that level is the whole tread, and it is
    // the tread the reference's own bands measure 2 to 4 rows across.
    // READ ON THE WATER, NEVER ON THE BOX. The tread's cells are the crossing plus the band, and both
    // are narrowed to what the ground offered; measuring from the first row to the face instead counts
    // rows the strip never cut, so a band with a dry row through it passes a floor it does not meet.
    const tread = [...reach, ...cut.band];
    if (rowsAcross(tread, dir, atRow) < BAND_DEPTH.min) break;
    floodCells(t, reach, tier);
    floodCells(t, cut.band, tier);
    floodCells(t, cut.landing, cut.landsAt);
    for (const c of [...reach, ...cut.band, ...cut.landing]) {
      cells.push(c);
      mine.add(flatIndex(c.x, c.y, t.width));
    }
    bands.push({ rect: boundsOfCells(tread), tier, landsAt: cut.landsAt });
    head ??= middleOf(cut.band);
    if (bands.length === 1) top = spanWidth(cut.span);
    foot = middleOf(cut.landing);
    // The strip keeps ONE cross position all the way down and only ever narrows, so the bands stack
    // rather than drift: the next search starts at the landing row of THIS band, over its own span.
    span = cut.span;
    landed = { x: atRow.x + dir[0], y: atRow.y + dir[1] };
    from = landed;
    tier = cut.landsAt;
    tiers.add(tier);
  }

  if (bands.length < steps || !head) return null;
  return { bands, cells, head, foot, footTier: tier, tiers: tiers.size, width: top };
}

/** How many distinct rows ALONG the fall line the tread's own cells stand on: the depth a visitor sees
 *  at this tier, counted off the water rather than off the span it was drawn inside. */
function rowsAcross(cells: readonly MacroCoord[], dir: Vec, at: MacroCoord): number {
  const rows = new Set<number>();
  for (const c of cells) rows.add((c.x - at.x) * dir[0] + (c.y - at.y) * dir[1]);
  return rows.size;
}

/** The offsets along the fall line's perpendicular that a band spans, inclusive: the strip's own
 *  cross-section, which narrows from band to band and never moves off its axis. */
interface Span { lo: number; hi: number }
const spanWidth = (s: Span): number => s.hi - s.lo + 1;

/** One band as it was cut: the cells at its own tier, the row it pours onto, and the span it took. */
interface Band {
  band: MacroCoord[];
  landing: MacroCoord[];
  landsAt: number;
  /** How deep the band came out, in rows: what the crossing above it is measured against. */
  rows: number;
  span: Span;
}

interface BandInput {
  input: StairInput;
  free: (c: MacroCoord, tier: number) => boolean;
  at: (row: MacroCoord, k: number) => MacroCoord;
  rowOf: (row: MacroCoord, span: Span) => MacroCoord[];
  row: MacroCoord;
  dir: Vec;
  span: Span;
  tier: number;
  depth: number;
}

/**
 * The band on the step ahead of one row of the strip, its landing, and the level it pours onto.
 *
 * The band is that row and the `depth - 1` rows behind it, drawn over the widest CAPPED run of free
 * ground the row offers inside the span it inherited. Its FRONT row is the one that shows a face, so the
 * cell just outside each end of the run is read for the cap V-WTR-02 asks for — mountain at exactly the
 * band's own tier, which any dry terrace cell at that tier is, so a run one cell narrower than the free
 * ground it was found in caps itself. The rows behind the front row face only their own water and are
 * asked for nothing but standing ground at their level. The landing is the row the fall pours onto,
 * uniform across the strip AND its caps (V-WTR-03) before it is flooded at its own level, so the fall
 * arrives in water rather than on a shelf.
 */
function cutBand(inp: BandInput): Band | null {
  const { input, free, at, rowOf, row, dir, span, tier, depth } = inp;
  const { t, grass, flat } = input;
  if (tier < 1) return null;
  const ahead = { x: row.x + dir[0], y: row.y + dir[1] };
  // A cheap gate before the run search: somewhere across the strip the ground ahead has to fall away.
  if (!rowOf(ahead, span).some((c) => { const s = surfaceOf(t, c.x, c.y); return s >= 0 && s < tier; })) {
    return null;
  }
  const found = widestCapped(t, grass, free, at, row, span, tier);
  if (!found) return null;

  const mid = at(ahead, (found.lo + found.hi) >> 1);
  const landsAt = surfaceOf(t, mid.x, mid.y);
  if (landsAt < 0 || landsAt >= tier) return null;

  const deep: MacroCoord[][] = [];
  for (let k = 0; k < depth; k++) {
    const back = { x: row.x - dir[0] * k, y: row.y - dir[1] * k };
    const cells = rowOf(back, found);
    if (!cells.every((c) => free(c, tier))) break;
    // The front row's flanks are the caps, already read; behind it, standing ground at the band's own
    // level is enough, since a row that faces only water shows no face to cap.
    if (k > 0 && !flanksStand(t, at, back, found, tier)) break;
    deep.push(cells);
  }
  // THE BAND SHOWS ONE FACE, DOWNSTREAM. Its flanks are capped and its fall is wanted, but the row
  // BEHIND the deepest one is a face too where the ground there stands lower — measured on a terrace
  // that ends at the shore two rows above the band, which left an uncapped face pointing back up the
  // flank and V-WTR-03 on the row in front of it. The deepest row is DROPPED rather than the band
  // refused: what is then behind the band is a row the band itself stood on, at its own level by
  // construction.
  while (deep.length > 0) {
    const back = { x: row.x - dir[0] * deep.length, y: row.y - dir[1] * deep.length };
    if (rowOf(back, found).every((c) => surfaceOf(t, c.x, c.y) >= tier)) break;
    deep.pop();
  }
  if (deep.length < 1) return null;

  const landing = rowOf(ahead, found);
  const apron = boundsOfCells([...landing, at(ahead, found.lo - 1), at(ahead, found.hi + 1)]);
  if (!uniform(t, grass, apron)) return null;
  if (!cellsFit(t, grass, flat, landing, landsAt)) return null;
  return { band: deep.flat(), landing, landsAt, rows: deep.length, span: found };
}

/**
 * The widest run of free ground on one row, inside `span`, whose two ends carry a cap.
 *
 * A cap is dry terrace at exactly the band's tier, which the free ground beside the run already is, so a
 * run bounded by something else — a street's reservation, a lower terrace, another body's water — gives
 * up one cell at that end and caps itself there instead. This is the whole reason a stair can be cut on
 * a built island: the band takes what the row offers rather than the width the strip started with.
 */
function widestCapped(
  t: TerrainPlan, grass: Uint8Array, free: (c: MacroCoord, tier: number) => boolean,
  at: (row: MacroCoord, k: number) => MacroCoord, row: MacroCoord, span: Span, tier: number,
): Span | null {
  let best: Span | null = null;
  let open: number | null = null;
  // One cell either side of the span is walked too, since a cap may stand outside the band above.
  for (let k = span.lo - 1; k <= span.hi + 2; k++) {
    if (k <= span.hi + 1 && free(at(row, k), tier)) { open ??= k; continue; }
    if (open === null) continue;
    const lo = Math.max(span.lo, capsAt(t, grass, at(row, open - 1), tier) ? open : open + 1);
    const hi = Math.min(span.hi, capsAt(t, grass, at(row, k), tier) ? k - 1 : k - 2);
    if (hi - lo + 1 >= STAIR_WIDTH.min && (!best || hi - lo > best.hi - best.lo)) best = { lo, hi };
    open = null;
  }
  return best;
}

/** Whether both cells flanking a row of the strip stand at the band's level or above: no lateral face,
 *  so V-WTR-02 asks the row for no caps. */
function flanksStand(
  t: TerrainPlan, at: (row: MacroCoord, k: number) => MacroCoord, row: MacroCoord, span: Span,
  tier: number,
): boolean {
  const a = at(row, span.lo - 1), b = at(row, span.hi + 1);
  return surfaceOf(t, a.x, a.y) >= tier && surfaceOf(t, b.x, b.y) >= tier;
}

/**
 * The rows between the last landing and this band: the crossing, which is what joins the two into one
 * body a reader follows down the flank. An empty list means the band already meets the landing and there
 * is nothing to flood; NULL means the crossing cannot be flooded, and the caller ends the stair there
 * rather than reporting a figure the map will show as two pools.
 *
 * A crossing longer than `STAIR_JOIN` is refused — a whole terrace given to water is a rectangle framed
 * by mountain — and so is one the ground does not offer whole.
 */
function joinRows(inp: JoinInput): MacroCoord[] | null {
  const { input, free, at, rowOf, landed, atRow, dir, cut, tier } = inp;
  const { t, grass, flat } = input;
  if (!landed) return [];
  const gap = Math.abs(atRow.x - landed.x) + Math.abs(atRow.y - landed.y) - (cut.rows - 1);
  if (gap < 0 || gap > STAIR_JOIN) return null;
  const back = { x: atRow.x - dir[0] * (cut.rows - 1), y: atRow.y - dir[1] * (cut.rows - 1) };
  // THE CHUTE IS NARROWER THAN THE TREADS IT JOINS, and that is why a stair can cross a terrace floor
  // at all. A crossing shows no face, so it needs no caps and nothing but free ground at its own level;
  // asking for the band's whole width over as many as twelve rows asked for a clear channel where the
  // island's streets and lots stand, and it refused 427 crossings of 5107 attempts while the bands
  // either side of them were cuttable. It narrows monotonically, so what is left is free on every row.
  let chute: Span = cut.span;
  const rows: MacroCoord[] = [];
  for (let k = 0; ; k++) {
    const row = { x: landed.x + dir[0] * k, y: landed.y + dir[1] * k };
    if (row.x === back.x && row.y === back.y) break;
    if (k > STAIR_JOIN + cut.rows) return null;
    const run = widestFree(free, at, row, chute, tier);
    if (!run || spanWidth(run) < CHUTE_MIN) return null;
    chute = run;
    rows.push(row);
  }
  const out: MacroCoord[] = [];
  for (const row of rows) {
    for (const c of rowOf(row, chute)) if (freeAt(t, grass, flat, c.x, c.y, tier)) out.push(c);
  }
  // The crossing is judged as ONE body at the tread's level: everything around it stands at least that
  // high, which is what the landing above and the band below already do, so it shows no face.
  if (out.length > 0 && !cellsFit(t, grass, flat, out, tier)) return null;
  return out;
}

interface JoinInput {
  input: StairInput;
  free: (c: MacroCoord, tier: number) => boolean;
  at: (row: MacroCoord, k: number) => MacroCoord;
  rowOf: (row: MacroCoord, span: Span) => MacroCoord[];
  landed: MacroCoord | null;
  atRow: MacroCoord;
  dir: Vec;
  cut: Band;
  tier: number;
}

/** The longest run of free ground on one row inside `span`: what a crossing may take, which needs no
 *  caps because it shows no face. */
function widestFree(
  free: (c: MacroCoord, tier: number) => boolean,
  at: (row: MacroCoord, k: number) => MacroCoord, row: MacroCoord, span: Span, tier: number,
): Span | null {
  let best: Span | null = null;
  let open: number | null = null;
  for (let k = span.lo; k <= span.hi + 1; k++) {
    if (k <= span.hi && free(at(row, k), tier)) { open ??= k; continue; }
    if (open === null) continue;
    if (!best || k - 1 - open > best.hi - best.lo) best = { lo: open, hi: k - 1 };
    open = null;
  }
  return best;
}

/** Whether a cell is standing mountain at exactly `tier`: a cap. */
function capsAt(t: TerrainPlan, grass: Uint8Array, c: MacroCoord, tier: number): boolean {
  if (c.x < 0 || c.y < 0 || c.x >= t.width || c.y >= t.height) return false;
  const i = flatIndex(c.x, c.y, t.width);
  return grass[i] === 1 && t.water[i]! < 0 && t.tier[i] === tier;
}

/** One place a stair could start: the MIDDLE of a run of terrace with lower ground along one side, the
 *  direction that ground lies in, and how long the run is. */
interface Lip { at: MacroCoord; dir: Vec; run: number; score: number }

/**
 * The lips worth trying: every maximal RUN of untouched terrace at `STAIR_FROM_TIER` or above with
 * lower ground along one side of it, longest and highest first.
 *
 * The run is what a stair is scored by rather than the height, and the reason is the ground: measured
 * on real designed maps, the summit's own rim is the most crowded terrace on the island — the walk
 * ends there, so it carries pavement, a place and their reservations — and a search that ranked by
 * tier alone spent all forty of its tries on rim cells with no clear strip anywhere near them and cut
 * nothing at all. A long clear lip halfway down a flank is where a cascade can actually stand.
 *
 * A lip inside a band the movement line asked for by name is worth the whole `WALK_PULL` on its own,
 * so the map's first stair stands beside the climb a visitor takes wherever that ground offers one.
 */
function lips(input: StairInput): Lip[] {
  const { t, grass, flat, line } = input;
  const asked = (line?.waterWants ?? []).filter((w): w is WaterWant => w.kind === 'cascade');
  const walk = line?.trace ?? [];
  const nearWalk = (x: number, y: number): number => {
    let best = WALK_PULL;
    for (const c of walk) best = Math.min(best, Math.abs(c.x - x) + Math.abs(c.y - y));
    return best;
  };
  /** Whether (x, y) is a lip cell facing `dir`: untouched terrace with lower island ground ahead. */
  const isLip = (x: number, y: number, dir: Vec, tier: number): boolean => {
    if (x < 1 || y < 1 || x >= t.width - 1 || y >= t.height - 1) return false;
    const i = flatIndex(x, y, t.width);
    if (t.tier[i] !== tier || !grass[i] || flat[i] || t.water[i]! >= 0) return false;
    const nx = x + dir[0], ny = y + dir[1];
    if (nx < 0 || ny < 0 || nx >= t.width || ny >= t.height) return false;
    const below = surfaceOf(t, nx, ny);
    return below >= 0 && below < tier && grass[flatIndex(nx, ny, t.width)] === 1;
  };
  const seen = new Set<number>();
  const found: Lip[] = [];
  for (let y = 2; y < t.height - 2; y++) {
    for (let x = 2; x < t.width - 2; x++) {
      const tier = t.tier[flatIndex(x, y, t.width)]!;
      if (tier < STAIR_FROM_TIER) continue;
      for (const [d, dir] of DIRS.entries()) {
        if (!isLip(x, y, dir, tier) || seen.has(flatIndex(x, y, t.width) * 4 + d)) continue;
        const p = perp(dir);
        const cells: MacroCoord[] = [];
        for (const way of [1, -1] as const) {
          for (let k = way > 0 ? 0 : 1; ; k++) {
            const cx = x + p[0] * k * way, cy = y + p[1] * k * way;
            if (!isLip(cx, cy, dir, tier)) break;
            cells.push({ x: cx, y: cy });
            seen.add(flatIndex(cx, cy, t.width) * 4 + d);
          }
        }
        if (cells.length < STAIR_WIDTH.min + 2) continue;
        const at = middleOf(cells);
        const bonus = asked.some((w) => at.x >= w.rect.x && at.x < w.rect.x + w.rect.w
          && at.y >= w.rect.y && at.y < w.rect.y + w.rect.h) ? WALK_PULL : 0;
        found.push({
          at, dir, run: cells.length,
          score: cells.length + 2 * tier + bonus - nearWalk(at.x, at.y) / 2,
        });
      }
    }
  }
  found.sort((a, b) => b.score - a.score
    || (a.at.y - b.at.y) || (a.at.x - b.at.x) || (a.dir[0] - b.dir[0]) || (a.dir[1] - b.dir[1]));
  return found.slice(0, STAIR_TRIES);
}

const middleOf = (cells: readonly MacroCoord[]): MacroCoord => {
  const r = boundsOfCells(cells);
  return { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) };
};

const lerp = (a: number, b: number, v: number): number => a + (b - a) * (v < 0 ? 0 : v > 1 ? 1 : v);
