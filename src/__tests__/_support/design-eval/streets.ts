/**
 * The street network of a finished map: ramp discipline, straightness, street ends and bridge
 * alignment. Street ends are read by their end face, since the tip-cell count in
 * `scorecard.ts:connectivity` always reads zero on 2-wide streets (each end cell has two paved
 * neighbours).
 */
import { type GridState } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { objectRect } from '../../../state/object-geometry';
import { ARRIVAL_DECOR, ARRIVAL_REACH } from '../../../tools/generation/designer/streets/settle';
import { isBridge, isRamp } from '../../../core/model/traits';
import { cellCentre } from '../../../core/grid/grid-convert';
import { eachTerminus, readMap, type MapMasks } from '../../../tools/reading';

/** The terraced reference's ramp count (the garden town has none); a map may use none, more is overuse. */
export const RAMP_COUNT_MAX = 51;

/** The share of a map's ramps that may stand on pavement: the terraced reference has 2 of its 51
 *  there, so the margin is the reference's own rather than zero. */
export const RAMP_ON_PAVEMENT_MAX = 0.05;

export interface RampDiscipline {
  pass: boolean;
  ramps: number;
  /** Ramps standing on at least one paved cell. */
  onPavement: number;
  overlapCells: number;
  placementPass: boolean;
  countPass: boolean;
}

/**
 * Ramps overused or laid over roads. A ramp belongs at the step, off the pavement; the overlap rule
 * allows it (a road is a coating), so this reading holds it to `RAMP_ON_PAVEMENT_MAX`.
 *
 * Footprints are read by cell centres, unlike the engine's every-touched-cell reading, which would put
 * every ramp beside a street on it; the threshold is calibrated to centres.
 */
export function rampDiscipline(state: GridState, g = readMap(state)): RampDiscipline {
  let ramps = 0, onPavement = 0, overlapCells = 0;
  for (const o of state.objects.values()) {
    if (!isRamp(getCatalogItem(o.catalogId))) continue;
    ramps++;
    const r = objectRect(o);
    let hits = 0;
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
        const { x: cx, y: cy } = cellCentre({ x, y });
        if (cx < r.x || cx >= r.x + r.w || cy < r.y || cy >= r.y + r.h) continue;
        if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
        if (g.paved[y * g.W + x]) hits++;
      }
    }
    if (hits > 0) { onPavement++; overlapCells += hits; }
  }
  const placementPass = ramps === 0 || onPavement / ramps <= RAMP_ON_PAVEMENT_MAX;
  const countPass = ramps <= RAMP_COUNT_MAX;
  return { pass: placementPass && countPass, ramps, onPavement, overlapCells, placementPass, countPass };
}

/**
 * The share of pavement at a turn or crossing on the references: 13.7% terraced, 20.8% garden town.
 * Reported, not scored: paved squares inflate it (every cell reads as a turn) while a grid of straight
 * lines reads 0 to 5%. `meanRunLength` is what separates straight from wandering (references 38.0 and
 * 35.6, a network routed per lot 26 to 34).
 */
export const TURN_SHARE_REFERENCE = [0.137, 0.208] as const;

/** A paved cell reads as straight when its run one way is this many times its run the other way. A
 *  3-wide street 40 long reads 13; the cells where two such streets cross read 1. */
const STRAIGHT_RATIO = 2;

export interface StreetStraightness {
  paved: number;
  turnCells: number;
  turnShare: number;
  /** Mean length of the longer run through a paved cell: how long a street reads before it ends. */
  meanRunLength: number;
  score: number;
}

/**
 * Whether streets run straight or wander. A cell is at a turn or crossing when its paved run one way is
 * under `STRAIGHT_RATIO` times its run the other way; elsewhere the longer run is how far the street
 * reads, and the score holds the mean of it against the references'.
 */
export function streetStraightness(state: GridState, g = readMap(state)): StreetStraightness {
  const { W, H } = g;
  const run = (x: number, y: number, horiz: boolean): number => {
    let n = 1;
    for (let k = 1; ; k++) {
      const nx = horiz ? x + k : x, ny = horiz ? y : y + k;
      if (nx >= W || ny >= H || !g.paved[ny * W + nx]) break;
      n++;
    }
    for (let k = 1; ; k++) {
      const nx = horiz ? x - k : x, ny = horiz ? y : y - k;
      if (nx < 0 || ny < 0 || !g.paved[ny * W + nx]) break;
      n++;
    }
    return n;
  };
  let paved = 0, turnCells = 0, runSum = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!g.paved[y * W + x]) continue;
      paved++;
      const hr = run(x, y, true), vr = run(x, y, false);
      const long = Math.max(hr, vr), short = Math.max(1, Math.min(hr, vr));
      runSum += long;
      if (long / short < STRAIGHT_RATIO) turnCells++;
    }
  }
  const turnShare = paved ? turnCells / paved : 0;
  const runMean = paved ? runSum / paved : 0;
  return {
    paved, turnCells, turnShare,
    meanRunLength: runMean,
    // Held against the references' 35.6 to 38.0.
    score: paved ? Math.min(1, runMean / 36) : 0,
  };
}

export { ARRIVAL_REACH };

/** The share of termini a map may leave arriving at nothing: twice the worse reference's share. */
export const ARRIVAL_DEAD_END_MAX = 0.15;

/** Dead ends always allowed, the reference's own count, since a share alone fails small maps. */
export const ARRIVAL_DEAD_END_FLOOR = 2;

export interface StreetArrivals {
  /** End faces read on the map. */
  termini: number;
  arrived: number;
  deadEnds: number;
  /** Dead ends as a share of termini. 0 where a map has no street ends at all. */
  deadEndShare: number;
  pass: boolean;
  /** The first few dead ends, so a caller can point at them. */
  where: { x: number; y: number }[];
}

/**
 * Every street end on a finished map and what it arrives at. A terminus (`eachTerminus`) arrives when,
 * within `ARRIVAL_REACH`, there stands the plaza, a crossing, a structure, water or coast, or a
 * composed place of `ARRIVAL_DECOR` planted cells.
 */
export function streetArrivals(state: GridState, g = readMap(state)): StreetArrivals {
  let termini = 0, arrived = 0;
  const where: { x: number; y: number }[] = [];
  eachTerminus(g.paved, g.W, g.H, (face, dx, dy) => {
    termini++;
    if (arrivesAt(g, face, dx, dy)) arrived++;
    else if (where.length < 8) where.push({ x: face[0]! % g.W, y: (face[0]! / g.W) | 0 });
  });
  const deadEnds = termini - arrived;
  const deadEndShare = termini > 0 ? deadEnds / termini : 0;
  return {
    termini, arrived, deadEnds, deadEndShare,
    pass: deadEnds <= ARRIVAL_DEAD_END_FLOOR || deadEndShare <= ARRIVAL_DEAD_END_MAX,
    where,
  };
}

const inside = (x: number, y: number, W: number, H: number): boolean =>
  x >= 0 && y >= 0 && x < W && y < H;

/**
 * Whether a walker would call a terminus an arrival. Only the cells ahead are read: a street running
 * along a lake and stopping in grass has water beside it but has arrived at nothing.
 *
 * Planting counts only within one cell of the street's line, the rest across the whole reach: a deck
 * or a doorway a step aside is still the destination, a garden the street runs past is not.
 */
function arrivesAt(g: MapMasks, face: readonly number[], dx: number, dy: number): boolean {
  const { W, H } = g;
  let decor = 0;
  for (const i of face) {
    const fx = i % W, fy = (i / W) | 0;
    for (let k = 1; k <= ARRIVAL_REACH; k++) {
      for (let across = -ARRIVAL_REACH; across <= ARRIVAL_REACH; across++) {
        const x = fx + dx * k + dy * across, y = fy + dy * k + dx * across;
        // Off the map or off the planet: the coast is a place to stop.
        if (!inside(x, y, W, H)) return true;
        const j = y * W + x;
        if (!g.land[j] || g.water[j]) return true;
        if (g.anchor[j] || g.crossing[j] || g.structure[j]) return true;
        if (Math.abs(across) <= 1 && g.plantAt[j] !== undefined) decor++;
      }
    }
  }
  return decor >= ARRIVAL_DECOR;
}

/**
 * How far past a deck's end the reading looks for the pavement it lands on. A bridge carries the
 * `halfStep` trait, so its footprint can sit half a cell off the grid and the landing cell is one or
 * two past the reported rect; at one cell out, 41 of 48 decks joined by construction touch no pavement.
 */
const DECK_LANDING = 3;

/** How far the runs at a landing are followed, along the deck's axis and across it. */
const DECK_RUN = 6;

/**
 * How far the pavement must carry on away from a deck to read as the street it continues: the
 * generator's 2-wide street plus one, so a deck butted into a street's flank (two cells) falls short.
 */
const DECK_CARRY = 3;

export interface BridgeAlignment {
  bridges: number;
  /** Decks whose axis the pavement carries on along at both ends. */
  aligned: number;
  /** Decks with a paved end that only runs across the deck: a street the deck was laid at right
   *  angles to, which reads as a deck into the side of a road. */
  crossways: number;
  /** Where the first few crossways decks stand, so a log entry can name them. */
  where: { x: number; y: number }[];
  score: number;
}

/**
 * Whether each deck continues its street. `bridge-span.ts` turns a deck to the water's narrow
 * direction, so a street along a paved bank can get a deck laid into its side; read on the pavement,
 * this holds whoever laid the deck.
 *
 * Only `crossways` is a defect. `aligned` is a reading: a reference with streets along its banks reads
 * few aligned decks, and a deck at a bend reads unaligned at one end.
 */
export function bridgeAlignment(state: GridState, g = readMap(state)): BridgeAlignment {
  const { W, H } = g;
  const out: BridgeAlignment = { bridges: 0, aligned: 0, crossways: 0, where: [], score: 1 };
  for (const o of state.objects.values()) {
    if (!isBridge(getCatalogItem(o.catalogId))) continue;
    out.bridges++;
    const r = objectRect(o);
    // The deck's own axis: a bridge is long across the gap it spans.
    const alongX = r.w >= r.h;
    const step = alongX ? [1, 0] as const : [0, 1] as const;
    const across = alongX ? [0, 1] as const : [1, 0] as const;
    /** The run of pavement from a cell along one direction, one way or both. */
    const run = (
      at: { x: number; y: number }, dir: readonly [number, number], sides: readonly number[],
    ): number => {
      let n = 0;
      for (const side of sides) {
        for (let k = 1; k <= DECK_RUN; k++) {
          const x = at.x + dir[0] * side * k, y = at.y + dir[1] * side * k;
          if (x < 0 || y < 0 || x >= W || y >= H || !g.paved[y * W + x]) break;
          n++;
        }
      }
      return n;
    };
    let ends = 0, crossways = 0;
    for (const sign of [-1, 1] as const) {
      // The cell just past this end of the footprint, and the first paved cell out from it.
      const from = sign < 0
        ? { x: r.x - step[0], y: r.y - step[1] }
        : { x: r.x + (alongX ? r.w : 0), y: r.y + (alongX ? 0 : r.h) };
      let landing: { x: number; y: number } | null = null;
      for (let k = 0; k < DECK_LANDING && !landing; k++) {
        const x = from.x + step[0] * sign * k, y = from.y + step[1] * sign * k;
        if (x >= 0 && y >= 0 && x < W && y < H && g.paved[y * W + x]) landing = { x, y };
      }
      if (!landing) continue;
      // Measured away from the deck only (the other way is the gap), and against `DECK_CARRY` rather
      // than the across-run, so a deck landing at a T-junction with a good continuation still passes.
      const along = run(landing, step, [sign]);
      if (along >= DECK_CARRY) { ends++; continue; }
      if (run(landing, across, [-1, 1]) > 0) crossways++;
    }
    if (ends === 2) out.aligned++;
    else if (crossways > 0) {
      out.crossways++;
      if (out.where.length < 4) out.where.push({ x: r.x, y: r.y });
    }
  }
  out.score = out.bridges ? out.aligned / out.bridges : 1;
  return out;
}
