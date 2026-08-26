/**
 * THE STREET NETWORK, READ OFF A FINISHED MAP: ramp discipline, straightness, and where a street
 * ends.
 *
 * The dead-end reading here is the one a person makes. The tip-cell measure the hard ledger also
 * carries (`scorecard.ts:connectivity`) counts paved cells with at most one paved neighbour, and on
 * a network built out of 2-cell-wide stamps it can only ever read zero: the two cells at the end of
 * a 2-wide street each have two paved neighbours, so a stub of street stopping in open grass is
 * invisible to it. The user saw dead ends on maps that metric scored 0.
 */
import { ItemCategory, type GridState } from '../../../../core/model/types';
import { categoryOf } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import { eachTerminus } from '../streets/street-ends';
import { readGrid, type EvalGrid } from './grid';

/** Map-level summary: "Bridges / ramps | 5 / 51" on the terraced reference, 9 / 0 on the garden town.
 *  A map may use no ramp at all; using more than the reference's own count is overuse. */
export const RAMP_COUNT_MAX = 51;

/** The share of a map's ramps that may stand on pavement. The terraced reference reads 2 of its 51
 *  that way, so the rule is "a ramp does not sit on the street" with the reference's own margin on
 *  it rather than a zero its own author did not keep. */
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
 * RAMPS AS ROAD FURNITURE: the failure this catches is ramps overused and laid over roads.
 *
 * A ramp joins a street to the terrace above it and stands AT the step, so no cell of its footprint
 * may also be pavement. The placement-overlap rule allows it — a road is a coating, and a coating is
 * coated over rather than blocked — which is exactly why this has to be measured rather than left to
 * the rules. The threshold is the reference's own margin (`RAMP_ON_PAVEMENT_MAX`), not zero.
 *
 * A ramp anchors on the HALF grid, so its footprint is read by cell CENTRES: a 1-wide ramp at x+0.5
 * covers the right half of one cell and the left half of the next, and only the cell whose centre
 * lies under it is a cell the ramp stands on. THAT DIVERGES FROM THE ENGINE, whose rules and index
 * read a footprint as every cell it touches at all: a half-grid ramp touches a cell either side of
 * itself, and an any-overlap reading would call every ramp beside a street a ramp on it. The threshold
 * above is measured against the reference under THIS reading, so unifying the two conventions moves the
 * threshold with it.
 */
export function rampDiscipline(state: GridState): RampDiscipline {
  const g = readGrid(state);
  let ramps = 0, onPavement = 0, overlapCells = 0;
  for (const o of state.objects.values()) {
    if (categoryOf(o) !== ItemCategory.Ramp) continue;
    ramps++;
    const r = objectRect(o);
    let hits = 0;
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
        const cx = x + 0.5, cy = y + 0.5;
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
 * The share of pavement standing at a turn or a crossing on the two decoded references: 13.7% on the
 * terraced island, 20.8% on the garden town.
 *
 * RETIRED AS A TARGET. Their figure is inflated by paved SQUARES, where every cell of a plaza reads
 * as a turn, while a grid of literally straight lines reads 0 to 5% — so the band never separated a
 * straight network from a wandering one, and scoring against it would have asked this stage to bend
 * its streets. `meanRunLength` is the straightness reading that does separate them (the references
 * 38.0 and 35.6, a network routed per lot 26 to 34), and the turn share stays beside it as a reported
 * number.
 */
export const TURN_SHARE_REFERENCE = [0.137, 0.208] as const;

/** A paved cell reads as STRAIGHT when its run one way is this many times its run the other way. A
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
 * TURNS PER UNIT STREET LENGTH: the failure this catches is streets that read as random.
 *
 * A cell is at a turn or a crossing when its paved run one way is not much longer than its run the
 * other way; everywhere else the cell is inside a straight street, and the longer run is how far
 * that street reads. Both references are grids of long straight streets, so the reading is banded
 * between them rather than minimized.
 */
export function streetStraightness(state: GridState): StreetStraightness {
  const g = readGrid(state);
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
    // The run length carried against the references' own 35.6 to 38.0, which is what actually
    // separates a straight network from a routed one.
    score: paved ? Math.min(1, runMean / 36) : 0,
  };
}

/**
 * A DEAD END IS A STREET THAT ARRIVES AT NOTHING, and this is the reading that says so.
 *
 * The tip-cell measure beside it (`connectivity`) counts paved cells with at most one paved
 * neighbour, and on a network built out of 2-cell-wide stamps it can only ever read zero: the two
 * cells at the end of a 2-wide street each have two paved neighbours, so a stub of street stopping
 * in open grass is invisible to it. The user saw dead ends on maps the metric scored 0. This measure
 * is re-derived from what a person calls one.
 *
 * A TERMINUS is the end FACE of a street: a run of paved cells with nothing paved in front of them,
 * street behind them for `TERMINUS_DEPTH`, and unpaved ground at both flanks — which is what
 * distinguishes a street stopping from a jog in the edge of a square. Faces wider than
 * `TERMINUS_WIDE` are squares and aprons rather than streets, and are not read.
 *
 * A terminus ARRIVES when something is there to arrive at, within `ARRIVAL_REACH` of the face: the
 * plaza, a crossing (the ramp or deck the walk carries on over), a building or facility, the water
 * or the coast, or a composed place — read as `ARRIVAL_DECOR` planted cells, since what a walker
 * meets at the end of a garden path is the garden. Anything else is pavement that stops in the
 * middle of open ground.
 */
export const ARRIVAL_REACH = 4;

const ARRIVAL_DECOR = 4;

/**
 * The share of termini a map may leave arriving at nothing.
 *
 * Derived from the references by this same code: the style target reads 2 dead ends of 28 termini
 * (7.1%, both of them one street that stops six cells short of its own shore) and the garden town 0
 * of 31. The bar is twice the worse of the two — a map may end a street in open ground about as
 * often as an expert does, and no oftener.
 *
 * A SHARE ALONE IS THE WRONG BAR ON A SMALL MAP, which is why the count stands beside it: a quiet
 * island with thirteen street ends fails at two of them and a busy one passes at seven, for the same
 * two streets.
 *
 * The bar is twice the worse of the two references and the floor is the style target's own count.
 * Both halves have to bite for the reading to mean anything: the planner's arrival rule moved this
 * generator from 5-34% of street ends arriving at nothing to 0-12% over both templates and three
 * richness levels, so a gate set anywhere near the top of that pre-rule range would pass a generator
 * that had no arrival rule at all.
 */
export const ARRIVAL_DEAD_END_MAX = 0.15;

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

/** One street end: the paved cells of its face and the direction the street was heading. */
export interface Terminus { face: { x: number; y: number }[]; dx: number; dy: number }

/** Every street end on a finished map. The dressing reads this to compose something at the end of a
 *  path, which is what the arrival reading below then finds there. */
export function streetTermini(state: GridState): Terminus[] {
  const g = readGrid(state);
  const out: Terminus[] = [];
  eachTerminus(g.paved, g.W, g.H, (face, dx, dy) => {
    out.push({ face: face.map((i) => ({ x: i % g.W, y: (i / g.W) | 0 })), dx, dy });
  });
  return out;
}

/** Every street end on a finished map, and what each one arrives at. */
export function streetArrivals(state: GridState): StreetArrivals {
  const g = readGrid(state);
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
 * Whether anything stands at a terminus that a walker would call arriving.
 *
 * Everything is read in the FORWARD CONE — the cells the street was heading for — and nothing behind
 * or beside the last paved cell. A street running ALONG a lake and stopping in open grass has a lake
 * all round its end and has arrived at nothing; reading the water omnidirectionally called that an
 * arrival, which is the opposite of what a walker sees.
 *
 * The cone is wider for the things a street is BUILT toward than for a composed place: a deck or a
 * doorway a step off the street's own line is still what the street was going to, while a garden the
 * street merely runs past is not what it ended at.
 */
function arrivesAt(g: EvalGrid, face: readonly number[], dx: number, dy: number): boolean {
  const { W, H } = g;
  let decor = 0;
  for (const i of face) {
    const fx = i % W, fy = (i / W) | 0;
    for (let k = 1; k <= ARRIVAL_REACH; k++) {
      for (let across = -ARRIVAL_REACH; across <= ARRIVAL_REACH; across++) {
        const x = fx + dx * k + dy * across, y = fy + dy * k + dx * across;
        // Off the map or off the island: the street ran out at the coast, which is a place to stop.
        if (!inside(x, y, W, H)) return true;
        const j = y * W + x;
        if (!g.land[j] || g.water[j]) return true;
        if (g.plaza[j] || g.crossing[j] || g.structure[j]) return true;
        if (Math.abs(across) <= 1 && g.plantAt[j] !== undefined) decor++;
      }
    }
  }
  return decor >= ARRIVAL_DECOR;
}

/**
 * How far past a deck's end the reading looks for the pavement it lands on.
 *
 * It is not slack, it is the half grid: a bridge carries the `halfStep` trait, so its anchor and
 * therefore its footprint can sit half a cell off the macro grid, and the cell a deck actually lands
 * on is one or two past the rect its own footprint reports. Read at exactly one cell out, 41 of 48
 * decks come back touching no pavement at all on maps where every deck is joined to the network by
 * construction.
 */
const DECK_LANDING = 3;

/** How far the runs at a landing are followed, along the deck's axis and across it. */
const DECK_RUN = 6;

/**
 * How far the pavement must carry on AWAY from a deck before it reads as a street the deck continues.
 *
 * Three, and the number is the street's own width plus one: every road this generator lays is two
 * cells wide, so a deck butted into the FLANK of a street finds exactly two cells along its own axis
 * and stops. A bar at two passes that; a bar at three asks the pavement to go somewhere.
 */
const DECK_CARRY = 3;

export interface BridgeAlignment {
  bridges: number;
  /** Decks whose axis the pavement carries on along at BOTH ends. */
  aligned: number;
  /** Decks with a paved end that only runs ACROSS the deck: a street the deck was laid at right
   *  angles to, which reads as a deck into the side of a road. */
  crossways: number;
  /** Where the first few crossways decks stand, so a log entry can name them. */
  where: { x: number; y: number }[];
  score: number;
}

/**
 * DOES A DECK CONTINUE THE STREET IT CROSSES FOR? The failure this catches is a bridge laid
 * perpendicular to the road.
 *
 * A bridge is the walk carrying ON across a gap, so the pavement at each of its ends has to run along
 * the deck's own axis. `bridge-span.ts` resolves a deck's rotation from the GAP it finds beside the
 * anchor cell, which is the water's narrow direction and not the street's: a street running ALONG a
 * bank, with the bank already paved, gets a deck laid at right angles into its side, joined to the
 * network and carrying nobody anywhere.
 *
 * The reading is taken on the pavement rather than on the plan, so it holds whoever laid the deck.
 *
 * `crossways` IS THE DEFECT AND `aligned` IS ONLY A READING, and the references say why: the garden
 * town reads 7 of its 9 decks aligned but the terraced island reads 0 of 5, because its bridges cross
 * open water between banks whose streets run ALONG them — a deck there lands on a bare bank and the
 * walk turns onto the street rather than continuing down it. Neither reference has a single crossways
 * deck. So a gate belongs on `crossways` alone; `aligned` is reported beside it as the direction of
 * travel, and a deck at a genuine BEND legitimately reads unaligned at one end.
 */
export function bridgeAlignment(state: GridState, g = readGrid(state)): BridgeAlignment {
  const { W, H } = g;
  const out: BridgeAlignment = { bridges: 0, aligned: 0, crossways: 0, where: [], score: 1 };
  for (const o of state.objects.values()) {
    if (categoryOf(o) !== ItemCategory.Bridge) continue;
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
      // HOW FAR THE PAVEMENT GOES ON AWAY FROM THE DECK. Measured away only, because the other way is
      // the gap the deck spans and would read as nothing whatever the street does; and against
      // `DECK_CARRY` rather than against the across-run, because a deck landing at a T-junction has a
      // long cross street beside a perfectly good continuation and is not the defect.
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
