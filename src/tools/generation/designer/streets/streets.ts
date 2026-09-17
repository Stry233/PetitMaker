/**
 * Stage B partitions terrace plates with seeded straight streets. A street skeleton is dilated by
 * its rank width only where the full stamp is paveable; unreachable fragments are pruned. Inline
 * ramp flights reconnect street segments across tiers, while entry flights serve otherwise isolated
 * districts. The plan is pure and deterministic and is committed by later stages.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import { makeRng, type Rng } from '../../../../core/model/rng';
import { CellZone, ItemCategory, type MapTemplate, type Rect } from '../../../../core/model/types';
import { getPlaceableByCategory } from '../../../../state/catalog';
import { cellTiers, plazaRect, type CompositionPlan } from '../composition/composition';
import { LINE_W, type MovementLine } from '../composition/movement-line';
import { RAMP_RUN, type SeedInfo } from '../types';

// --- the road facts the whole generator reads ------------------------------------------------------

/** The game's own two rank widths: a trunk is 3 cells wide, a branch 2, and nothing is 1. */
export const TRUNK_W = 3;
export const BRANCH_W = 2;

/** Plain network surface plus three restrained accent materials. */
export const ROAD_DOMINANT = 'path-rustic-dirt';
export const ROAD_ACCENTS = ['path-garden-stone', 'path-lattice-red-brick', 'path-urban-asphalt'] as const;
/** One material carries 87 to 95% of the pavement on both references. */
export const DOMINANT_SHARE = 0.87;

// --- what a street plan is -------------------------------------------------------------------------

/** The two street ranks, plus the apron ring the plaza wears (trunk width, its own rank because it
 *  belongs to the hub rather than to any one street). */
export type RoadRank = 'apron' | 'trunk' | 'branch';

/** One paved macro cell: where it is, which rank claimed it, and what it is paved with. */
export interface RoadCell { x: number; y: number; rank: RoadRank; material: string }

/** One straight street: a line at one coordinate, laid over a contiguous stretch of the planet. */
export interface StreetRun {
  rank: 'trunk' | 'branch';
  /** The axis the street RUNS along: 'y' is a vertical street (its line is an x coordinate). */
  axis: 'x' | 'y';
  /** The skeleton's fixed coordinate: x for a vertical street, y for a horizontal one. */
  line: number;
  width: number;
  /** Inclusive range along `axis` the skeleton covers. */
  from: number;
  to: number;
  /** A stretch of the MOVEMENT LINE: the map's primary walk, laid before anything else and carried
   *  over every tier step it meets. Absent on an ordinary street. */
  primary?: boolean;
  /** Total cells already eroded from each end across all settling passes, low end first. */
  eroded?: [number, number];
  /** Whether each end has consumed its one near-miss join attempt, low end first. */
  joinedEnd?: [boolean, boolean];
}

/** One ramp, positioned and rotated the way the heightDrop trait resolves it, so the footprint here
 *  is the footprint the engine will store. */
export interface RampSpec {
  catalogId: string;
  position: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  /** The high end the ramp reaches, which is what a placed ramp stores. */
  elevation: number;
  footprint: Rect;
}

/** A street's crossing of one tier step: one ramp per tier, plus the terrace landings the sculptor
 *  must carve between them (the last flight of steps lands on the low plate's own surface, so it
 *  needs no landing of its own). */
export interface RampFlight {
  /** Index into `StreetPlan.streets`: the street the flight carries, or the one it climbs off. */
  street: number;
  /** An ENTRY flight climbs off a street at right angles onto the terrace beside it, and has
   *  pavement at its foot only; an inline one carries a street over a step, with pavement at both
   *  ends. */
  entry: boolean;
  axis: 'x' | 'y';
  highTier: number;
  lowTier: number;
  /** The whole corridor the flight occupies, pavement cleared. */
  corridor: Rect;
  ramps: RampSpec[];
  landings: { rect: Rect; tier: number }[];
}

/** One block of the partition: open land bounded by streets, plate edges and the coast. */
export interface District {
  id: number;
  cells: number[];
  rect: Rect;
  tier: number;
  /** Does a street or a flight reach this block from the plaza? */
  served: boolean;
}

/**
 * Where the movement line steps over a gap: the stretch of the primary trunk left unpaved so the
 * sculptor can open it and a deck can span it.
 *
 * A bridge spans any BELOW-DECK gap between two flat ends of equal height, so a crossing comes in
 * two kinds and the ground decides which. On a stretch at elevation 0 nothing can be dug, so the gap
 * is FLOODED; on a raised stretch it is a GORGE cut `GORGE_DROP` tiers into the terrace, which is the
 * only kind a terraced map can offer — its ground is not at sea level anywhere, so a map with a water
 * grammar and no gorges stands almost no bridges.
 *
 * `gap` is the whole reserved stretch and `open` the part of it that is opened. They differ by one
 * cell: a coating validates its own cell plus one column right and one row below, so the
 * pavement immediately west or north of a hole can never be laid, and the gap has to hold that cell
 * as well or the street beside it is a road the rules refuse.
 */
export interface LineCrossing {
  kind: 'water' | 'gorge';
  gap: Rect;
  open: Rect;
  /** The tier the two banks stand at. */
  tier: number;
  /** The axis the street runs along; the gap lies across it. */
  axis: 'x' | 'y';
  /** Macro cells of open gap the deck spans. The catalog's bridges carry 3 to 6. */
  span: number;
}

export interface StreetPlan {
  seedInfo: SeedInfo;
  streets: StreetRun[];
  /** Every paved macro cell, in raster order, with the rank that first claimed it. */
  cells: RoadCell[];
  ramps: RampSpec[];
  flights: RampFlight[];
  districts: District[];
  materials: { dominant: string; accents: string[] };
  /** Ids of districts no street reaches: empty on a healthy plan. */
  unserved: number[];
  /** The gaps the movement line steps over, for the sculptor to open and a deck to span. */
  crossings: LineCrossing[];
}

// --- tunables ----------------------------------------------------------------------------------

/** Branch-street centre spacing. Flat maps use a denser grid; terraces provide extra partitions. */
const SPACING = { low: 20, high: 24 } as const;
/** How far a single gap may stand from the nominal spacing, as a share of it. A ruled grid is the
 *  thing the eye reads first and likes least, and the references have a wide block-size spread at one
 *  pavement share (the garden town's median block is half its mean), so the gaps vary widely. */
const SPACING_SPREAD = 0.45;
/** How much each gap grows over the one inside it. The blocks by the plaza are the town's and the
 *  ones at the rim are its fields, which is the game's own 中心 -> 四周 read as block size, and it is what
 *  gives a map the references' spread of block areas at one pavement share. */
const SPACING_GROWTH = 0.26;
/** How far a line may be nudged off its nominal coordinate to find ground it can actually run on. */
const OFFSET_SEARCH = 4;
/**
 * Stagger long streets at bounded intervals, replacing four-way crossings with paired T-junctions
 * and capping uninterrupted runs. Quiet flat maps stagger less often because each street supplies
 * more district frontage.
 */
const LONG_RUN_SHARE = 0.55;
const STAGGER_EVERY = { low: 70, high: 50 } as const;
/** How far across a street steps when it staggers. Wide enough that the two T-junctions read as two
 *  (the junction reading gathers a meeting within about four cells of itself into one node), narrow
 *  enough that the step does not walk the street into its own neighbour. */
const JOG_MIN = 6;
const JOG_MAX = 10;
/** The shortest stretch of a jogged street worth stepping across for: under this the stagger buys a
 *  fragment rather than a street, and the line runs on straight instead. How far ahead that stretch
 *  is judged over: a street of the same axis standing beyond the next stagger says nothing about
 *  whether this step is clear. */
const JOG_MIN_RUN = 12;
const JOG_LOOK = 50;
/** How far along a refused bend is tried again. One street's width plus a little: far enough that
 *  the ground under the step is different ground, short enough that the line does not reach the
 *  coast before it finds any. */
const BEND_RETRY = 6;
/** How close to the plaza the anti-grid rule stops applying: inside this the streets are the hub's
 *  own ring, and the ring has to close. */
const RING_KEEP = 12;
/**
 * The richness below which the anti-grid does not run at all.
 *
 * The quiet end of the axis is the FLAT GARDEN TOWN reference: a thin grid on a plain, with no terraces
 * cutting the planet and nothing else partitioning it. Every street there carries a block's whole
 * frontage, so a stagger costs one — at richness 0, one seed comes back with seven of its thirty street
 * ends stopping in open grass, ground the erosion cannot take back because each stub is the only pavement
 * its block has. The lattice reading is taken at full richness (`scorecard.ts:noLattice`).
 */
const ANTI_GRID_FROM = 0.15;
/** Weight on hugging a plate edge when a nudge is chosen: a street laid along the natural block edge
 *  is the reference's own habit, and the alternative — a street a cell or two INSIDE the edge —
 *  leaves a sliver of terrace nobody can compose on. */
const HUG_BONUS = 0.2;
/** The shortest piece of a trunk that is still a spine. Below it the piece is laid as a branch: the
 *  rank hierarchy is about what a street CARRIES, and a fragment carries a block's frontage. */
const TRUNK_MIN_RUN = 20;
/** The shortest street piece worth keeping. Below this it is a stub between two obstacles rather
 *  than a street, and it would read as pavement with no purpose. */
const PIECE_MIN = 6;
/** How far inside a block's own foot the street that serves it stands. Two cells: where the foot is a
 *  terrace step the rim cell before it can never be paved (the coating's window reads the step), so
 *  the stamp starts on the first cell that can be. */
const BLOCK_LINE_INSET = 2;
/**
 * A tail beyond the last junction longer than this is trimmed, unless it ends somewhere a walker
 * understands a street stopping — the coast, a flight, a crossing's channel, the plaza.
 *
 * It is ONE cell, not a street's own width: pavement running out into open grass is what the eye
 * reads as a dead end however few tip cells it holds, and at the quiet end of the richness axis
 * there is not yet a composed place at the end of every path for it to arrive at.
 */
const TAIL_MAX = 1;

/**
 * How much of one end a street may lose to the arrival rule.
 *
 * Past this the pavement is a street that runs out rather than a stub, and its length is what the
 * blocks along it are fronted by. A PIECE SHORTER THAN THIS GOES ENTIRELY: a six-cell fragment
 * between two terrace steps that arrives at neither of them is not a street a walker can use, and
 * leaving it standing is what the arrival ledger reads as a dead end — the settling then drops what
 * is left of it, since a run under `PIECE_MIN` is not a piece.
 */
const TRIM_MAX = 8;
/** How far past its own end a street may look for what it arrives at. The evaluation's arrival
 *  reading uses the same reach, so the plan and the finished map agree about what a dead end is. */
const ARRIVE_REACH = 4;
/** How wide a gap the near-miss join closes. A terrace seam costs a street one or two cells (the
 *  coating's window reads the step); past that the pavement was not nearly there. */
const JOIN_REACH = 3;
/**
 * How far ahead of a tip a street still counts as the one this street ARRIVED at.
 *
 * It is the gap the join leaves behind, and the two numbers have to agree or the settling oscillates:
 * the join stops one cell short of the target (that cell is the target's own pavement), so a tip
 * whose arrival test only looked at the cell under it read the joined street as arriving nowhere,
 * the trimming took the join back, and the next pass joined it again — for every pass the bound
 * allowed, leaving the board in whatever state the last one happened to make.
 */
const JOIN_LEFT = 1;
/** Ramps a map may carry, at richness 0 and 1. The terraced reference carries 51 and the flat one
 *  carries none, so the budget spans the two; the spanning construction usually spends far less. */
const RAMP_BUDGET = { low: 8, high: 44 } as const;
/** Ramp styles one map draws from. The terraced reference uses four, dominated by one. */
const RAMP_STYLES = 3;
/** The smallest block worth an entry flight of its own, in cells. Below a composed place's own area
 *  a block is a verge, and a staircase up onto one reads as furniture nobody asked for. */
const ENTRY_MIN_CELLS = 120;
/**
 * The shortest pair of stretches an OPPORTUNITY flight is built between.
 *
 * The spanning growth buys the ramps that make the network one walk; this is the second half of the
 * rule — where a street runs into a step and a ramp is legal and would connect, one stands, whether or
 * not the walk could already get there another way. A step between
 * two stubs is furniture; a step between two real streets is a way up, so the two stretches have to
 * be streets before the ramp is worth its budget.
 */
const OPPORTUNITY_MIN_RUN = 10;

/** How many places the movement line may step over water, at richness 0 and 1. The style target
 *  carries five bridges; a walk that crosses more than a couple of channels is a causeway. */
const CROSSING_COUNT = { low: 1, high: 3 } as const;
/** Open water a crossing spans, in macro cells: inside the 3 to 6 the catalog's bridges carry. */
const CROSSING_SPAN = 4;
/** Cells of the trunk a crossing takes: the water, plus the one cell of dry margin the coating's own
 *  window forbids pavement on. */
const CROSSING_GAP = CROSSING_SPAN + 1;
/** How many legs of the walk are laid at the full primary width before it steps down to a trunk. */
const LINE_WIDE_LEGS = 1;
/** How far from a street's ends a crossing may sit. A channel cut at the very end of a trunk leaves a
 *  stub on the far bank rather than a way onward. */
const CROSSING_INSET = 8;
/** How far apart two crossings stand. Two channels within sight of each other read as one river the
 *  map could not decide the shape of. */
const CROSSING_APART = 20;

// --- entry point -------------------------------------------------------------------------------

/** The street layer of one map: the lines, the pavement they lay, the flights that carry them over
 *  the composition's tier steps, and the districts the two of them cut the planet into. */
export function planStreets(
  seed: number, template: MapTemplate, composition: CompositionPlan,
  richness = composition.seedInfo.richness, line?: MovementLine,
): StreetPlan {
  const r = clamp01(richness);
  // The first decision off the stream is a weighted draw, and mulberry32 answers neighbouring seeds
  // with neighbouring first floats — the seed is avalanched so a batch counting up does not lay the
  // same streets over and over.
  const rng = makeRng(mix(seed, 0x2b7e1516));
  const board = makeBoard(template, composition);

  const laid = layStreets(board, composition, r, seed, line);
  const styles = pickStyles(rng);
  // Which style a given flight wears is hashed from its own coordinates against this salt rather than
  // drawn off the stream: a candidate is offered again on every pass of the growth in `planFlights`,
  // and a stream draw would answer one flight differently depending on how many passes it took.
  const salt = rng.int(0x7fffffff);
  const budget = Math.round(lerp(RAMP_BUDGET.low, RAMP_BUDGET.high, r));
  const inline = planFlights(board, laid, styles, salt, budget);
  // The blocks an entry flight is for are the ones the FINISHED network leaves shut, so the streets
  // are settled once before they are looked for: a street that the pruning is about to take back
  // would otherwise read as the access a block already has.
  const settled = settle(board, laid, inline);
  const spent = inline.reduce((n, f) => n + f.ramps.length, 0);
  const entries = planEntries(board, settled.streets, composition, budget - spent, styles, salt);
  const withEntries = settle(board, settled.streets, [...settled.flights, ...entries]);
  const opportunity = planOpportunities(
    board, withEntries.streets, styles, salt,
    budget - withEntries.flights.reduce((n, f) => n + f.ramps.length, 0),
  );
  let { streets, flights } = settle(board, withEntries.streets, [...withEntries.flights, ...opportunity]);
  // THE END OF A STREET IS A WAY ON OR IT IS A DEAD END. What is left after the growth is a stretch of
  // pavement that runs up to a terrace step and stops, which the arrival ledger reads as a street
  // ending at nothing — rightly, since a walker meeting a cliff has arrived nowhere. A flight there
  // is both the way on and the arrival.
  const ends = planEndFlights(board, streets, styles, salt, budget - spentOn(flights));
  if (ends.length > 0) ({ streets, flights } = settle(board, streets, [...flights, ...ends]));
  // THE CROSSINGS COME LAST, on the pavement the settling actually left: a channel is only cut where
  // the two banks stay joined to the plaza without it, so a deck that fails to land costs the map a
  // bridge rather than a network.
  const crossings = planCrossings(
    board, streets, flights, Math.round(lerp(CROSSING_COUNT.low, CROSSING_COUNT.high, r)),
  );
  // SETTLED ONE LAST TIME, WHATEVER THE CHANNELS DID. Every pass above can leave pavement the plaza
  // cannot walk to — a channel cut across a street, a bend whose two legs the ground refused, a
  // flight retired — and the settling is the only thing that takes it back. Running it only where a
  // crossing landed left one seed of sixty carrying a bend's link with both its legs gone.
  ({ streets, flights } = settle(board, streets, flights));
  const materials = assignMaterials(board, streets, rng, r);
  const districts = cutDistricts(board, composition);

  return {
    seedInfo: { seed, richness: r, templateId: template.id },
    streets,
    cells: readCells(board, materials.byStreet),
    ramps: flights.flatMap((f) => f.ramps),
    flights,
    districts,
    materials: { dominant: ROAD_DOMINANT, accents: materials.accents },
    unserved: districts.filter((d) => !d.served).map((d) => d.id),
    crossings,
  };
}

// --- the board ---------------------------------------------------------------------------------

interface Board {
  W: number; H: number;
  /** Buildable planet: the Grass zone. */
  land: Uint8Array;
  /** Plate tier per cell, -1 off the planet. */
  tier: Int8Array;
  /** Cells a road tile may be laid on: the `flat` trait's own window (the cell plus one column right
   *  and one row below) all on the planet at one tier, and clear of the plaza. So the mask already
   *  leaves the one-cell gap before every tier step that a flight exists to cross. */
  pavable: Uint8Array;
  plaza: Rect;
  hub: { x: number; y: number };
  /** The planet's own bounding extent, which a street's run is long or short a share OF. */
  extent: { w: number; h: number };
  paved: Uint8Array;
  /** Which street first paved a cell, -1 where none did. */
  owner: Int32Array;
  rankAt: Uint8Array;
  /** Cells a ramp footprint or its cleared corridor holds: pavement may never be laid there. */
  reserved: Uint8Array;
  /** Cells a street may legitimately END at: a LIVE flight's corridor and a crossing's channel, the
   *  two places the way on is a ramp or a deck rather than more pavement. Kept apart from
   *  `reserved`, which also holds the dual-grid margins of retired flights — ground nothing stands
   *  on, and a tail stopping there is a tail stopping at nothing. */
  stopAt: Uint8Array;
}

const RANK_CODE: Record<'trunk' | 'branch', number> = { trunk: 1, branch: 2 };
const RANK_OF = ['', 'trunk', 'branch'] as const;
const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function makeBoard(template: MapTemplate, composition: CompositionPlan): Board {
  const W = template.width, H = template.height, N = W * H;
  const land = new Uint8Array(N);
  const tier = new Int8Array(N).fill(-1);
  // The REALIZED field, not the plate's nominal tier: a plate's rim slopes down to the shore, and a
  // street planned on the nominal tier would be laid on ground that comes out lower than it read.
  const realized = cellTiers(template, composition);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (template.zones[y]?.[x] !== CellZone.Grass) continue;
      const i = flatIndex(x, y, W);
      land[i] = 1;
      tier[i] = realized[i]!;
    }
  }
  const plaza = plazaRect(template);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!land[flatIndex(x, y, W)]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const extent = x1 < 0 ? { w: W, h: H } : { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const pavable = new Uint8Array(N);
  for (let y = 0; y + 1 < H; y++) {
    for (let x = 0; x + 1 < W; x++) {
      const i = flatIndex(x, y, W);
      if (!land[i] || inRect(plaza, x, y)) continue;
      const t = tier[i]!;
      let ok = true;
      for (let dy = 0; dy <= 1 && ok; dy++) {
        for (let dx = 0; dx <= 1 && ok; dx++) {
          const j = flatIndex(x + dx, y + dy, W);
          ok = land[j] === 1 && tier[j] === t;
        }
      }
      if (ok) pavable[i] = 1;
    }
  }
  return {
    W, H, land, tier, pavable, plaza, extent,
    hub: { x: plaza.x + plaza.w / 2, y: plaza.y + plaza.h / 2 },
    paved: new Uint8Array(N), owner: new Int32Array(N).fill(-1),
    rankAt: new Uint8Array(N), reserved: new Uint8Array(N), stopAt: new Uint8Array(N),
  };
}

const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** The square a width-`w` street paves when its skeleton stands at `(x, y)`. Odd widths centre on the
 *  skeleton, even ones sit down-right of it, so a 2-wide street reserved at `y` comes out on exactly the
 *  two rows `y` and `y + 1`. */
function stampOf(x: number, y: number, w: number): Rect {
  const o = (w - 1) >> 1;
  return { x: x - o, y: y - o, w, h: w };
}

/** Whether a width-`w` skeleton may stand at `(x, y)`: its whole stamp is pavable and unreserved. */
function skeletonLegal(board: Board, x: number, y: number, w: number): boolean {
  const s = stampOf(x, y, w);
  if (s.x < 0 || s.y < 0 || s.x + s.w > board.W || s.y + s.h > board.H) return false;
  for (let cy = s.y; cy < s.y + s.h; cy++) {
    for (let cx = s.x; cx < s.x + s.w; cx++) {
      const i = flatIndex(cx, cy, board.W);
      if (!board.pavable[i] || board.reserved[i]) return false;
    }
  }
  return true;
}

// --- laying the lines ----------------------------------------------------------------------------

/** One candidate line before it is cut into pieces. A primary spec carries the range the movement
 *  line drew; every other spec runs the whole span of its axis. */
interface LineSpec {
  rank: 'trunk' | 'branch';
  axis: 'x' | 'y';
  line: number;
  width: number;
  primary?: boolean;
  from?: number;
  to?: number;
}
/** One stretch of a line the ground allows, before it is known whether the network reaches it. */
interface Piece { spec: LineSpec; from: number; to: number }

/**
 * The whole street layer, laid hierarchy first.
 *
 * The four TRUNKS are the plaza's own cross: two vertical lines tangent to the plaza's west and east
 * faces and two horizontal ones tangent to its north and south, each spanning the planet. They meet
 * at four corners, so the ring the game's guidance asks for around the hub and the four outward spines
 * its 中心 → 四周 asks for are the same four lines; they are laid in a turning order, so each one
 * crosses the one before it.
 *
 * A line is cut into the maximal pieces its ground allows, and EVERY piece is laid. Connectivity is
 * settled afterwards, by the flights and by `dropStranded`, because it cannot be settled here: a
 * piece on the plate above the plaza touches nothing until the flight that climbs to it exists, and
 * refusing to lay it would leave the flight no street to carry. Laying first and pruning after is
 * what lets a terraced planet be paved at all.
 */
function layStreets(
  board: Board, composition: CompositionPlan, richness: number, seed: number, line?: MovementLine,
): StreetRun[] {
  const out: StreetRun[] = [];
  const crown = crownMask(board, composition);
  for (const spec of lineSpecs(board, composition, richness, seed, line)) {
    layLine(board, spec, seed, richness, crown, out);
  }
  // THE BLOCKS THE GRID MISSED, once it is known which those are.
  for (const spec of unservedBlockLines(board, composition)) {
    layLine(board, spec, seed, richness, crown, out);
  }
  return out;
}

/**
 * The planet's TOP TERRACE, which the anti-grid leaves whole.
 *
 * The highest plate is where the planet's one set piece stands (`terrain/landmark.ts`) and where the
 * water story's own upper bodies are cut, and both of those need a panel of clear ground at ONE
 * tier: a staggered street cuts the terrace into pieces none of which is wide enough, and the figure
 * pass comes back with nothing while a pond trimmed to what is left comes back a rectangle the water
 * ledger reads as a tofu lake. Measured, one seed of twenty lost its figure and another gained a
 * 23-cell rimmed rectangle that way.
 *
 */
function crownMask(board: Board, composition: CompositionPlan): Uint8Array {
  const top = composition.plates.reduce((m, p) => Math.max(m, p.tier), 0);
  const mask = new Uint8Array(board.W * board.H);
  if (top <= 0) return mask;
  for (let i = 0; i < mask.length; i++) if (board.tier[i] === top) mask[i] = 1;
  return mask;
}

/** One line, staggered where it meets another street, then cut into the pieces its ground allows and
 *  laid at the width the ground takes. */
function layLine(
  board: Board, spec: LineSpec, seed: number, richness: number, crown: Uint8Array, out: StreetRun[],
): void {
  // THE PRIMARY WALK IS LAID AS WIDE AS THE GROUND TAKES IT, STRETCH BY STRETCH. Its width is the
  // widest pavement on the map, which is what makes it legible as the map's own line; where the
  // terrace it crosses is too narrow for that stamp it steps down to a trunk and then to a branch,
  // exactly as a trunk does against the plaza's ring. Asking the whole leg at ONE width left the
  // narrow stretches bare — on a terraced planet the walk came back less than half paved, which is a
  // walk with holes in it rather than a walk that narrows.
  //
  // AND IT NEVER STAGGERS: the walk is the one line a visitor is meant to follow from the plaza to
  // the summit, and a walk that steps sideways at every street it meets is not one line any more.
  if (spec.primary) { layPrimary(board, spec, out); return; }
  if (richness < ANTI_GRID_FROM) { layStraight(board, spec, out); return; }
  for (const leg of staggered(board, spec, seed, richness, crown, out)) layStraight(board, leg, out);
}

/** One straight stretch of a line: cut into the pieces its ground allows, laid at the width the
 *  ground takes. */
function layStraight(board: Board, spec: LineSpec, out: StreetRun[]): void {
  {
    let pieces = piecesOf(board, spec);
    // A TRUNK THAT CANNOT STAND AT THREE STANDS AT TWO. The four trunks are the plaza's own ring,
    // and the ring is as wide as the composition left it: where the hub's plate keeps only a
    // two-cell verge, a 3-wide stamp fits nowhere along it and the map comes back with no street
    // against the plaza at all — which prunes every other street on the planet for being
    // unreachable (measured on one seed of sixty). A 2-wide apron is still a street, and the
    // hierarchy is a preference, not a hard rule; what IS hard is that no road is 1 wide.
    if (spec.rank === 'trunk' && pieces.length === 0) {
      pieces = piecesOf(board, { ...spec, width: BRANCH_W });
    }
    for (const piece of pieces) {
      // A SHORT PIECE OF A TRUNK IS NOT A TRUNK. The plaza's cross is cut into as many pieces as its
      // ground allows, and on a rim or a terraced planet that can be a dozen fragments; a six-cell
      // fragment three cells wide is a stub, not a spine, and a map made of them reads as one rank
      // however many lines were planned. The rank is what the piece can carry, so a fragment is laid
      // at branch width and the hierarchy stays a hierarchy.
      const short = piece.spec.rank === 'trunk' && !piece.spec.primary
        && piece.to - piece.from + 1 < TRUNK_MIN_RUN;
      layPiece(board, short ? { ...piece, spec: { ...piece.spec, rank: 'branch', width: BRANCH_W } } : piece, out);
    }
  }
}

/**
 * ONE LINE, BROKEN INTO THE LEGS A STAGGERED STREET WALKS (the supplement's OFFSET crossing).
 *
 * The line is walked from one end; every stretch where it lies over a street of the other axis is a
 * CROSSING it could stagger at. It staggers once it has run `STAGGER_EVERY` cells since its last step
 * across, and it must once it has run more than `LONG_RUN_SHARE` of the planet. Each leg is returned
 * bounded to its own stretch and carrying its own coordinate; consecutive legs OVERLAP the crossing
 * street they meet at, so each of them ends against it and the pair reads as two T-junctions rather
 * than one four-way.
 *
 * THREE THINGS HAVE TO HOLD or the line runs on straight, since a fragment across the road is worse
 * than the crossing it was avoiding: the ground on the far side can carry a street worth having
 * (`JOG_MIN_RUN`), the new coordinate does not walk into a street already running the same way, and
 * the crossing street is paved right across the step (`bridges`) so the far leg is joined to
 * something.
 *
 * The jog's size and side are POSITIONAL (`hash01` over the line and the crossing), not off the rng
 * stream: a line's staggers must not move because an earlier line found different ground.
 */
function staggered(
  board: Board, spec: LineSpec, seed: number, richness: number, crown: Uint8Array,
  laid: readonly StreetRun[],
): LineSpec[] {
  const along = spec.axis === 'y' ? board.H : board.W;
  const first = Math.max(0, spec.from ?? 0);
  const last = Math.min(along - 1, spec.to ?? along - 1);
  // ROUNDED, because it is added to a coordinate. A fractional bend point indexes the board between
  // cells, every lookup there reads undefined, and the bend is refused every time it is offered — it
  // was a silent no-op on every line whose planet extent was not a multiple of the share.
  const longRun = Math.round(LONG_RUN_SHARE * (spec.axis === 'y' ? board.extent.h : board.extent.w));
  const every = lerp(STAGGER_EVERY.low, STAGGER_EVERY.high, richness);
  const legs: LineSpec[] = [];
  let from = first, line = spec.line, at = first, postpone = 0;
  // The crossings are found as the walk reaches them rather than all at once: a stagger moves the
  // line, and what the line meets after one is not what the original coordinate would have met.
  for (;;) {
    const cross = nextCrossing(board, { ...spec, line }, laid, at, last);
    const bendAt = from + longRun + postpone;
    if (cross && cross.a <= bendAt) {
      at = cross.b + 1;
      // Past the long-run bound the stagger is no longer a preference: a street that has crossed
      // more than `LONG_RUN_SHARE` of the planet in one line is the lattice, whatever the interval says.
      const due = cross.a - from >= every || cross.b - from > longRun;
      if (!due || nearHub(board, spec.axis, line, cross.a) || onCrown(board, crown, spec.axis, line, cross.a)) continue;
      const jog = jogFor(board, { ...spec, line }, laid, seed, cross.a, last);
      if (jog === 0) continue;
      // AND THE CROSSING STREET HAS TO CARRY THE STEP. The two legs of a stagger are joined by the
      // street they meet at and by nothing else, so where that street's own pavement does not reach
      // from one leg's coordinate to the other's — a short piece, a stretch its ground cut — the far
      // leg is born orphaned and the settling prunes it. What is left is a network with a street
      // missing rather than a Z, which is what a map reading under-served is made of. The bend path
      // has always asked this of its own link (`linkable`); this asks it of the crossing.
      if (!bridges(board, spec.axis, line, line + jog, cross)) continue;
      legs.push({ ...spec, line, from, to: cross.b });
      from = cross.a;
      line += jog;
      postpone = 0;
      continue;
    }
    // THE STREET IS DUE A TURN AND NOTHING CROSSES IT (the supplement's 弯折的道路, its fourth
    // junction form). The two legs are joined by a short link across the step, so the bend is one
    // walk with a corner in it rather than two streets that happen to be near each other.
    //
    // A REFUSED BEND IS POSTPONED, NOT ABANDONED. Giving up on the line the first time its ground,
    // its hub ring or its crown said no let the rest of it run straight to the coast, which is the
    // planet-spanning street this whole operator exists to remove: measured, one seed of ten came
    // back with 9.1% of its pavement in such a line. The point of the turn walks on instead, and a
    // crossing that appears before the new one is taken in its place.
    if (bendAt >= last) break;
    if (nearHub(board, spec.axis, line, bendAt) || onCrown(board, crown, spec.axis, line, bendAt)) {
      postpone += BEND_RETRY;
      continue;
    }
    const jog = jogFor(board, { ...spec, line }, laid, seed, bendAt, last);
    // AND THE LINK'S OWN GROUND HAS TO CARRY IT, whole. A bend whose link the ground refuses leaves
    // two legs that never meet: the near one is a street ending in open grass and the far one is
    // pavement the plaza reaches by some other route or not at all.
    if (jog === 0 || !linkable(board, spec, line, line + jog, bendAt)) {
      postpone += BEND_RETRY;
      continue;
    }
    legs.push({ ...spec, line, from, to: bendAt });
    // The link runs BETWEEN the two legs' own coordinates and no further: `stampOf` already spreads
    // a skeleton position over the street's width, so a link carried past the far leg is a stub
    // beyond the junction — pavement with one neighbour, which is what the tip-cell ledger counts.
    legs.push({
      ...spec, axis: spec.axis === 'y' ? 'x' : 'y', line: bendAt,
      from: Math.min(line, line + jog), to: Math.max(line, line + jog),
    });
    from = bendAt;
    line += jog;
    at = bendAt + 1;
    postpone = 0;
  }
  legs.push({ ...spec, line, from, to: last });
  return legs;
}

/** Whether a point on a line stands on the planet's top terrace. */
function onCrown(board: Board, crown: Uint8Array, axis: 'x' | 'y', line: number, at: number): boolean {
  const x = axis === 'y' ? line : at;
  const y = axis === 'y' ? at : line;
  if (x < 0 || y < 0 || x >= board.W || y >= board.H) return false;
  return crown[flatIndex(x, y, board.W)] === 1;
}

/** Whether the street a stagger meets at is paved right across the step, from one leg's coordinate
 *  to the other's, somewhere inside the crossing's own stretch. */
function bridges(
  board: Board, axis: 'x' | 'y', from: number, to: number, cross: { a: number; b: number },
): boolean {
  for (let u = Math.min(from, to); u <= Math.max(from, to); u++) {
    let paved = false;
    for (let t = cross.a; t <= cross.b && !paved; t++) {
      const x = axis === 'y' ? u : t;
      const y = axis === 'y' ? t : u;
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      if (board.paved[flatIndex(x, y, board.W)]) paved = true;
    }
    if (!paved) return false;
  }
  return true;
}

/** Whether the short link across a bend can be laid along its whole span. */
function linkable(board: Board, spec: LineSpec, from: number, to: number, at: number): boolean {
  const axis = spec.axis === 'y' ? 'x' : 'y';
  for (let t = Math.min(from, to); t <= Math.max(from, to); t++) {
    const x = axis === 'y' ? at : t;
    const y = axis === 'y' ? t : at;
    if (!skeletonLegal(board, x, y, spec.width)) return false;
  }
  return true;
}

/**
 * Whether a point on a line stands close enough to the plaza that the street through it is the hub's
 * own ring.
 *
 * The four trunks are tangent to the plaza's four faces and meet at its corners, so the ring asked for
 * around the hub and the four spines of 中心 → 四周 are the same four lines. A ring that steps aside at
 * its own corner does not close: one seed comes back with a third of its pavement gone, every street
 * beyond the broken corner pruned for being unreachable from a plaza no street touched. So the anti-grid
 * rule starts outside the hub.
 */
function nearHub(board: Board, axis: 'x' | 'y', line: number, at: number): boolean {
  const x = axis === 'y' ? line : at;
  const y = axis === 'y' ? at : line;
  const p = board.plaza;
  const dx = Math.max(p.x - x, 0, x - (p.x + p.w - 1));
  const dy = Math.max(p.y - y, 0, y - (p.y + p.h - 1));
  return Math.max(dx, dy) <= RING_KEEP;
}

/** The next stretch along the line, at or after `at`, where it lies over a street running the other
 *  way. */
function nextCrossing(
  board: Board, spec: LineSpec, laid: readonly StreetRun[], at: number, last: number,
): { a: number; b: number } | null {
  let start = -1;
  for (let t = at; t <= last; t++) {
    if (crossesAt(board, spec, laid, t)) { if (start < 0) start = t; continue; }
    if (start >= 0) return { a: start, b: t - 1 };
  }
  return start >= 0 ? { a: start, b: last } : null;
}

/** Whether the line's stamp at `t` stands on pavement laid by a street of the OTHER axis. */
function crossesAt(board: Board, spec: LineSpec, laid: readonly StreetRun[], t: number): boolean {
  const x = spec.axis === 'y' ? spec.line : t;
  const y = spec.axis === 'y' ? t : spec.line;
  const s = stampOf(x, y, spec.width);
  for (let cy = s.y; cy < s.y + s.h; cy++) {
    for (let cx = s.x; cx < s.x + s.w; cx++) {
      if (cx < 0 || cy < 0 || cx >= board.W || cy >= board.H) continue;
      const owner = board.owner[flatIndex(cx, cy, board.W)]!;
      if (owner >= 0 && laid[owner]!.axis !== spec.axis) return true;
    }
  }
  return false;
}

/** How far across the line steps at this crossing, or 0 where the far side cannot carry it: the
 *  ground has to hold a street worth having, and the new coordinate has to be clear of a street
 *  already running the same way. */
function jogFor(
  board: Board, spec: LineSpec, laid: readonly StreetRun[], seed: number, from: number, last: number,
): number {
  const span = spec.axis === 'y' ? board.W : board.H;
  const roll = hash01(mix(seed, mix(spec.line, from)), 0x5bf0);
  const drawn = JOG_MIN + Math.floor(roll * (JOG_MAX - JOG_MIN + 1));
  const signs = hash01(mix(seed, from), spec.line) < 0.5 ? [-1, 1] : [1, -1];
  // THE SIZE IS NEGOTIABLE, THE STEP IS NOT. The draw picks how far across the line would like to
  // step; where that lands on ground the street cannot run on, a shorter step is still a step, and
  // the alternative is the line running on to the coast — measured, one seed of ten kept 9.5% of its
  // pavement in a planet-spanning street because one branch was offered a single width.
  const tries: { size: number; sign: number }[] = [];
  for (let size = drawn; size >= JOG_MIN; size--) for (const sign of signs) tries.push({ size, sign });
  for (const { size, sign } of tries) {
    const line = spec.line + sign * size;
    if (line < 0 || line >= span) continue;
    // Judged over the stretch the stepped-across leg will actually occupy, not the whole rest of the
    // line: a street of the same axis standing anywhere beyond the next stagger says nothing about
    // whether this step is clear, and reading to the end refused nearly every step there was.
    const until = Math.min(last, from + JOG_LOOK);
    let legal = 0, parallel = false;
    for (let t = from; t <= until && !parallel; t++) {
      const x = spec.axis === 'y' ? line : t;
      const y = spec.axis === 'y' ? t : line;
      const s = stampOf(x, y, spec.width);
      for (let cy = s.y; cy < s.y + s.h && !parallel; cy++) {
        for (let cx = s.x; cx < s.x + s.w; cx++) {
          if (cx < 0 || cy < 0 || cx >= board.W || cy >= board.H) continue;
          const owner = board.owner[flatIndex(cx, cy, board.W)]!;
          if (owner >= 0 && laid[owner]!.axis === spec.axis) { parallel = true; break; }
        }
      }
      if (skeletonLegal(board, x, y, spec.width)) legal++;
    }
    if (!parallel && legal >= JOG_MIN_RUN) return sign * size;
  }
  return 0;
}

/**
 * The primary walk, laid stretch by stretch at the widest rank each stretch can carry.
 *
 * The gaps a wider stamp could not stand in are offered to the next rank down, so the line is
 * continuous over the terraces: wide where the ground is wide, a trunk where it narrows, a branch
 * where that is all there is. Every stretch is laid once — a gap is only offered to a narrower rank
 * where nothing was laid at a wider one — so the walk is one street rather than several stacked.
 */
function layPrimary(board: Board, spec: LineSpec, out: StreetRun[]): void {
  const along = spec.axis === 'y' ? board.H : board.W;
  const first = Math.max(0, spec.from ?? 0);
  const last = Math.min(along - 1, spec.to ?? along - 1);
  const laid: [number, number][] = [];
  for (const width of [spec.width, TRUNK_W, BRANCH_W]) {
    if (width > spec.width) continue;
    for (const [from, to] of gapsIn(first, last, laid)) {
      for (const piece of piecesOf(board, { ...spec, width, from, to })) {
        layPiece(board, piece, out);
        laid.push([piece.from, piece.to]);
      }
    }
  }
}

/** The stretches of `[first, last]` no piece has taken yet, long enough to be a street. */
function gapsIn(first: number, last: number, taken: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = first;
  for (const [from, to] of [...taken].sort((a, b) => a[0] - b[0])) {
    if (from > at) out.push([at, from - 1]);
    at = Math.max(at, to + 1);
  }
  if (at <= last) out.push([at, last]);
  return out.filter(([from, to]) => to - from + 1 >= PIECE_MIN);
}

/** The lines a map wants: the movement line first, then the plaza's trunks, then branches outward
 *  from the hub. The walk is laid before anything else so it takes the ground it wants and the rest
 *  of the network composes around it. */
function lineSpecs(
  board: Board, composition: CompositionPlan, richness: number, seed: number, line?: MovementLine,
): LineSpec[] {
  const p = board.plaza;
  const o = (TRUNK_W - 1) >> 1;
  // West, north, east, south: a turning order, so every trunk crosses the one laid before it at a
  // corner of the plaza's ring.
  const trunks: LineSpec[] = [
    { rank: 'trunk', axis: 'y', line: p.x - TRUNK_W + o, width: TRUNK_W },
    { rank: 'trunk', axis: 'x', line: p.y - TRUNK_W + o, width: TRUNK_W },
    { rank: 'trunk', axis: 'y', line: p.x + p.w + o, width: TRUNK_W },
    { rank: 'trunk', axis: 'x', line: p.y + p.h + o, width: TRUNK_W },
  ];
  const spacing = lerp(SPACING.low, SPACING.high, richness);
  const branches: LineSpec[] = [];
  for (const axis of ['y', 'x'] as const) {
    const span = axis === 'y' ? board.W : board.H;
    const lo = axis === 'y' ? p.x - TRUNK_W + o : p.y - TRUNK_W + o;
    const hi = axis === 'y' ? p.x + p.w + o : p.y + p.h + o;
    // Each gap is drawn separately, so the blocks come out UNEQUAL. An exactly ruled grid reads as
    // graph paper and gives every block the same area; the decoded references have a wide block-size
    // spread at one pavement share (the garden town's median is half its mean), and unequal gaps are
    // where that spread comes from. The draw is positional, not off the rng stream, so a line's
    // spacing does not move when an earlier line's search does.
    for (const side of [-1, 1] as const) {
      let at = side < 0 ? lo : hi;
      for (let k = 1; ; k++) {
        const grown = spacing * (1 + SPACING_GROWTH * (k - 1));
        at += side * Math.round(grown * lerp(1 - SPACING_SPREAD, 1 + SPACING_SPREAD, hash01(mix(seed, axis === 'y' ? 1 : 2), side * k)));
        if (at < 0 || at >= span) break;
        branches.push({ rank: 'branch', axis, line: at, width: BRANCH_W });
      }
    }
  }
  // Nearest the hub first, so a branch meets the network the trunks already laid.
  const hubOf = (s: LineSpec): number => Math.abs(s.line - (s.axis === 'y' ? board.hub.x : board.hub.y));
  branches.sort((a, b) => hubOf(a) - hubOf(b) || (a.axis < b.axis ? -1 : 1) || a.line - b.line);
  // THE WALK IS WIDEST WHERE IT LEAVES THE PLAZA. The style target's approaches read 4 to 6 cells
  // against a 3-wide trunk, which is what a street does as it nears the
  // centre; a 4-wide line all the way to the coast would also put three quarters of the map's
  // pavement at trunk width, and neither reference does that.
  const primary: LineSpec[] = (line?.segments ?? []).map((seg, k) => ({
    rank: 'trunk', axis: seg.axis, line: seg.line, width: k < LINE_WIDE_LEGS ? LINE_W : TRUNK_W,
    primary: true, from: seg.from, to: seg.to,
  }));
  return [
    ...primary, ...trunks,
    ...branches.map((s) => ({ ...s, line: bestOffset(board, s, composition, seed) })),
  ];
}

/**
 * A street ALONG every block the grid left unserved, raised or flat.
 *
 * IT IS NOT A TERRACE FEATURE, though a terrace is what makes it necessary. The grid is a set of
 * full-planet lines, and half of them meet a TERRACE across its short side: the piece they can lay there
 * is shorter than a street, so it is dropped and the terrace comes back bare — a mass carrying a quarter
 * of the planet's land and a twentieth of its pavement, which is a single-storey walk with a viewpoint
 * bolted on the end. But an unserved block is not the mass's alone: a coast eating a line, a plaza ring,
 * a piece the settling pruned all leave one on a flat planet too, and this pass answers those the same
 * way. There is no tier test — a block with no street is the defect, whatever height it stands at — and
 * the measured consequence is that the quiet end of the richness axis lays MORE of this than the
 * terraced end, which is where the paved-share and district-count ceilings both come from.
 *
 * So a block no street reaches is offered a line down its own LONG axis, bounded to its own extent.
 * Asked for AFTER the grid rather than beside it, which is what keeps it from paving anything the
 * grid already serves; from there it is a branch like any other, laid where the ground takes it,
 * joined by the flights that follow, and pruned by the settling where the network never reaches it.
 */
function unservedBlockLines(board: Board, composition: CompositionPlan): LineSpec[] {
  const out: LineSpec[] = [];
  for (const block of cutDistricts(board, composition)) {
    if (block.served || block.cells.length < ENTRY_MIN_CELLS) continue;
    const r = block.rect;
    if (Math.min(r.w, r.h) < BLOCK_LINE_INSET + BRANCH_W || Math.max(r.w, r.h) < PIECE_MIN) continue;
    // ALONG THE FOOT OF THE BLOCK, not down its middle: that is where the reference planet's own
    // roads run, it leaves the block one straight frontage rather than two half-blocks, and where the
    // block is a terrace it is the side a flight can climb to — the low ground the ramps run down is
    // on the outside of it. On flat ground either side is a foot and the reading picks one.
    const axis: 'x' | 'y' = r.w >= r.h ? 'x' : 'y';
    const low = lowerSide(board, block, axis);
    const line = axis === 'x'
      ? (low > 0 ? r.y + r.h - 1 - BLOCK_LINE_INSET : r.y + BLOCK_LINE_INSET)
      : (low > 0 ? r.x + r.w - 1 - BLOCK_LINE_INSET : r.x + BLOCK_LINE_INSET);
    out.push({
      rank: 'branch', axis, line, width: BRANCH_W,
      from: axis === 'x' ? r.x : r.y,
      to: (axis === 'x' ? r.x + r.w : r.y + r.h) - 1,
    });
  }
  return out.sort((a, b) => a.line - b.line);
}

/**
 * Which side of the block the ground falls away on, across `axis`: +1 for the high-coordinate side,
 * -1 for the low one.
 *
 * That side is the terrace's FOOT — the side a flight can climb to, since the low ground the ramps
 * run down lies outside it, and the side the reference planet's own roads run along.
 */
function lowerSide(board: Board, block: District, axis: 'x' | 'y'): 1 | -1 {
  const r = block.rect;
  let ahead = 0, behind = 0;
  for (const i of block.cells) {
    const x = i % board.W, y = (i / board.W) | 0;
    const near = axis === 'x'
      ? [{ x, y: r.y + r.h }, { x, y: r.y - 1 }] as const
      : [{ x: r.x + r.w, y }, { x: r.x - 1, y }] as const;
    for (const [k, p] of near.entries()) {
      if (p.x < 0 || p.y < 0 || p.x >= board.W || p.y >= board.H) continue;
      const j = flatIndex(p.x, p.y, board.W);
      if (!board.land[j] || board.tier[j]! >= block.tier) continue;
      if (k === 0) ahead++; else behind++;
    }
  }
  return ahead >= behind ? 1 : -1;
}

/**
 * Where a branch line actually sits: the nudge within `OFFSET_SEARCH` of its nominal coordinate that
 * gives the line the most ground it can run on, with a bonus for standing right against a plate edge.
 *
 * The nudge is what makes streets follow the plates rather than cut across them at random: a line
 * lying ON a step is unpavable along its whole length (the flat trait reads the step), and a line one
 * cell inside a plate's edge strands the sliver between the two. So the search answers with the line
 * beside the edge wherever there is one nearby, and with open ground otherwise.
 */
function bestOffset(board: Board, spec: LineSpec, composition: CompositionPlan, seed: number): number {
  const span = spec.axis === 'y' ? board.W : board.H;
  let best = spec.line, bestScore = -1;
  // A seeded order over the offsets, so two maps with the same planet do not nudge identically where
  // the ground scores the same.
  const offsets = Array.from({ length: 2 * OFFSET_SEARCH + 1 }, (_, k) => k - OFFSET_SEARCH)
    .sort((a, b) => Math.abs(a) - Math.abs(b) || (hash01(seed ^ spec.line, a) < hash01(seed ^ spec.line, b) ? -1 : 1));
  for (const d of offsets) {
    const line = spec.line + d;
    if (line < 0 || line >= span) continue;
    let length = 0, hugs = 0;
    const along = spec.axis === 'y' ? board.H : board.W;
    for (let t = 0; t < along; t++) {
      const x = spec.axis === 'y' ? line : t;
      const y = spec.axis === 'y' ? t : line;
      if (skeletonLegal(board, x, y, spec.width)) length++;
      if (hugsPlateEdge(board, composition, x, y, spec)) hugs++;
    }
    const score = length + HUG_BONUS * hugs;
    if (score > bestScore) { bestScore = score; best = line; }
  }
  return best;
}

/** Does the street's stamp stand right against a plate edge at this point along the line? Read one
 *  cell either side of the stamp, across the street. */
function hugsPlateEdge(board: Board, composition: CompositionPlan, x: number, y: number, spec: LineSpec): boolean {
  const s = stampOf(x, y, spec.width);
  const here = flatIndex(x, y, board.W);
  if (!board.land[here]) return false;
  const plate = composition.plateOf[here]!;
  if (plate < 0) return false;
  const probes = spec.axis === 'y'
    ? [{ x: s.x - 1, y }, { x: s.x + s.w, y }]
    : [{ x, y: s.y - 1 }, { x, y: s.y + s.h }];
  for (const p of probes) {
    if (p.x < 0 || p.y < 0 || p.x >= board.W || p.y >= board.H) continue;
    const other = composition.plateOf[flatIndex(p.x, p.y, board.W)]!;
    if (other >= 0 && other !== plate) return true;
  }
  return false;
}

/** The maximal stretches of one line its ground allows, long enough to be a street. */
function piecesOf(board: Board, spec: LineSpec): Piece[] {
  const along = spec.axis === 'y' ? board.H : board.W;
  const first = Math.max(0, spec.from ?? 0);
  const last = Math.min(along - 1, spec.to ?? along - 1);
  const out: Piece[] = [];
  let start = -1;
  for (let t = first; t <= last + 1; t++) {
    const x = spec.axis === 'y' ? spec.line : t;
    const y = spec.axis === 'y' ? t : spec.line;
    const legal = t <= last && skeletonLegal(board, x, y, spec.width);
    if (legal) { if (start < 0) start = t; continue; }
    if (start >= 0) {
      if (t - start >= PIECE_MIN) out.push({ spec, from: start, to: t - 1 });
      start = -1;
    }
  }
  return out;
}

function layPiece(board: Board, piece: Piece, out: StreetRun[]): void {
  const index = out.length;
  const { spec } = piece;
  out.push({
    rank: spec.rank, axis: spec.axis, line: spec.line, width: spec.width,
    from: piece.from, to: piece.to, ...(spec.primary ? { primary: true } : {}),
  });
  paint(board, out[index]!, index);
}

/** Stamps a run's cells onto the board. */
function paint(board: Board, run: StreetRun, index: number): void {
  for (let t = run.from; t <= run.to; t++) {
    const x = run.axis === 'y' ? run.line : t;
    const y = run.axis === 'y' ? t : run.line;
    const s = stampOf(x, y, run.width);
    for (let cy = s.y; cy < s.y + s.h; cy++) {
      for (let cx = s.x; cx < s.x + s.w; cx++) {
        const i = flatIndex(cx, cy, board.W);
        // A RESERVED CELL IS NEVER PAVED, whoever is stamping. A flight's corridor and a crossing's
        // gap are both taken out of the pavement AFTER the runs were laid, and `restamp` lays every
        // run down again from the list: without this the next pass would pave the corridor back over
        // the ramp standing in it.
        if (board.paved[i] || board.reserved[i]) continue;
        board.paved[i] = 1;
        board.owner[i] = index;
        board.rankAt[i] = RANK_CODE[run.rank];
      }
    }
  }
}

/** Erases the stretch `[from, to]` of a run from the board, leaving cells another run also paved
 *  alone. Used when a flight claims a corridor and when a tail is trimmed. */
function erase(board: Board, run: StreetRun, index: number, from: number, to: number): void {
  for (let t = from; t <= to; t++) {
    const x = run.axis === 'y' ? run.line : t;
    const y = run.axis === 'y' ? t : run.line;
    const s = stampOf(x, y, run.width);
    for (let cy = s.y; cy < s.y + s.h; cy++) {
      for (let cx = s.x; cx < s.x + s.w; cx++) {
        const i = flatIndex(cx, cy, board.W);
        if (board.owner[i] !== index) continue;
        board.paved[i] = 0; board.owner[i] = -1; board.rankAt[i] = 0;
      }
    }
  }
}

// --- flights -------------------------------------------------------------------------------------

/** One ramp item as this planner reads it: which catalog id, and how wide across the street. */
interface RampStyle { id: string; width: number }

/**
 * A climb a flight COULD take, in the two shapes a flight comes in.
 *
 * INLINE: a street's own pavement stops at a tier step with more of the same street beyond it, and
 * the flight carries the street over. ENTRY: a street runs ALONG the foot of a terrace nobody can
 * step up onto, and the flight climbs off it at right angles, cutting the street where it crosses
 * it. The references use both — the terraced planet's roads run along its terrace feet and its
 * fifty-one ramps are how a walker leaves them.
 */
interface FlightCandidate {
  /** The run the flight belongs to: the street it carries (inline) or the one it crosses (entry). */
  street: number;
  /** The axis the flight CLIMBS along: for an entry that is the street's own cross-axis. */
  axis: 'x' | 'y';
  /** The fixed coordinate of the flight's line, in the axis it climbs. */
  line: number;
  entry: boolean;
  /** Low edge of the corridor across the climb. */
  across: number;
  /** The corridor's least extent across: the street's width for an inline flight, the ramp's own for
   *  an entry, which is what keeps an entry from eating a whole crossroads. */
  span: number;
  /** +1 where the ground descends as the along-coordinate grows. */
  down: 1 | -1;
  /** The along-coordinate of the HIGH plate's own edge cell: the cell the first ramp reads its cliff
   *  from, which the flat trait already forbids pavement on. */
  step: number;
  highTier: number;
  lowTier: number;
  /** What the flight is worth: the shorter of the two stretches it joins, or the size of the block
   *  it opens. The build order, so the ramps a map spends are the ones carrying real street. */
  weight: number;
}

/**
 * The flights, GROWN OUT FROM THE PLAZA as a spanning tree over the pavement.
 *
 * Every piece of pavement is a component; a flight is an edge between the two components a step
 * separates. Only flights that reach a component the plaza cannot yet walk to are built, so a map
 * carries exactly as many ramps as it needs to be one network and not one more. Growing from the plaza
 * rather than merging greedily
 * anywhere is what spends the budget on reaching the hub: a spanning FOREST would buy staircases
 * between two terraces nobody can get to in the first place. Components the budget cannot reach are
 * erased by `settle` rather than left standing unreachable.
 */
function planFlights(
  board: Board, streets: StreetRun[], styles: readonly RampStyle[], salt: number, budget: number,
): RampFlight[] {
  const groups = componentsOf(board);
  const joined = plazaComponents(board, groups.comp);
  // The movement line's own steps first, then the rest by what they carry: a budget spent before the
  // walk is carried over its steps would break the one street the map is composed around.
  const isPrimary = (c: FlightCandidate): number => (streets[c.street]?.primary ? 1 : 0);
  const candidates = findCandidates(board, streets).sort((a, b) =>
    isPrimary(b) - isPrimary(a) || b.weight - a.weight || a.street - b.street || a.step - b.step);

  const out: RampFlight[] = [];
  const used = new Uint8Array(candidates.length);
  let spent = 0;
  for (;;) {
    let built = false;
    for (let k = 0; k < candidates.length && spent < budget; k++) {
      if (used[k]) continue;
      const candidate = candidates[k]!;
      const flight = buildFlight(board, streets, candidate, styles, salt);
      if (!flight) { used[k] = 1; continue; }
      if (spent + flight.ramps.length > budget) continue;
      const a = groups.at(board, candidate, endOf(flight, candidate, -1));
      const b = groups.at(board, candidate, endOf(flight, candidate, 1));
      if (a < 0 || b < 0) { used[k] = 1; continue; }
      const inA = joined.has(a), inB = joined.has(b);
      // THE WALK IS CONTINUOUS OR IT IS NOT A WALK. A step in the middle of the movement line takes
      // its flight whether or not the network could already get to the far side another way: the
      // climb is the story, and a walk that has to leave its own line and come back is not one.
      if (inA === inB && !streets[candidate.street]?.primary) continue;
      // Two components neither of which the plaza reaches are still two components: a primary flight
      // joins them, and calling either one reachable would let a later flight that WOULD have joined
      // them to the hub be passed over as redundant.
      if (inA || inB) { joined.add(a); joined.add(b); }
      commitFlight(board, flight);
      out.push(flight);
      used[k] = 1;
      spent += flight.ramps.length;
      built = true;
    }
    if (!built) break;
  }
  return out;
}

/**
 * The ENTRY flights: a way up onto a block whose street runs along its foot.
 *
 * A street cannot be laid on a terrace's own edge — the flat trait forbids the cell before a step —
 * so a street following a terrace foot leaves the ground above it two cells away and unreachable.
 * That is the terraced reference's own arrangement, and its answer is a ramp: the flight here climbs
 * off the street at right angles, cutting it where it crosses. The street stays one network, since
 * the ramps conduct between the two pieces the cut leaves.
 *
 * Only blocks big enough to be composed on are worth a flight, and only one flight is spent per
 * block: this is access, not a staircase every few cells.
 */
function planEntries(
  board: Board, streets: readonly StreetRun[], composition: CompositionPlan,
  budget: number, styles: readonly RampStyle[], salt: number,
): RampFlight[] {
  const out: RampFlight[] = [];
  let spent = 0;
  // A BLOCK IS ONLY ENTERED ON THE LEVEL. `served` asks whether pavement runs ALONG a block, which a
  // street at the foot of a terrace does without offering any way up onto it — and that arrangement
  // is exactly what the style target answers with a ramp fifty-one times. So the flights are looked
  // for wherever a block big enough to compose on has no pavement at its own tier beside it,
  // whether or not a street runs past.
  const blocks = cutDistricts(board, composition)
    .filter((d) => d.cells.length >= ENTRY_MIN_CELLS && !enteredOnTheLevel(board, d))
    .sort((a, b) => b.cells.length - a.cells.length);
  for (const block of blocks) {
    if (spent >= budget) break;
    for (const candidate of entryCandidates(board, block)) {
      const flight = buildFlight(board, streets, candidate, styles, salt);
      if (!flight || spent + flight.ramps.length > budget) continue;
      commitFlight(board, flight);
      out.push(flight);
      spent += flight.ramps.length;
      break;
    }
  }
  return out;
}

/** Ramps a set of flights has already spent. */
function spentOn(flights: readonly RampFlight[]): number {
  return flights.reduce((n, f) => n + f.ramps.length, 0);
}

/**
 * A FLIGHT AT THE END OF A STREET that stops at a terrace step.
 *
 * The three passes above answer "which steps join two stretches of pavement". This one answers the
 * other half of the walk: a street that runs up to a cliff and stops. Nothing joins there, so no
 * spanning or opportunity flight is ever built, and the end reads to the arrival ledger exactly as a
 * walker reads it — pavement running out at a wall. The ramp is the way on AND the arrival, and the
 * terrace above it becomes ground the walk can reach, which is a storey of the map bought at one end of
 * one street.
 *
 * Anchored like an ENTRY flight (pavement at its foot only), because that is what it is: the street
 * it climbs off is its own, and there is nothing at the top yet.
 */
function planEndFlights(
  board: Board, streets: readonly StreetRun[], styles: readonly RampStyle[], salt: number,
  budget: number,
): RampFlight[] {
  const out: RampFlight[] = [];
  if (budget <= 0) return out;
  let spent = 0;
  // The longest streets first: the end of a spine is where a walker actually arrives, and a stub's
  // end is somewhere they never went.
  const order = streets
    .map((run, index) => ({ run, index }))
    .sort((a, b) => (b.run.to - b.run.from) - (a.run.to - a.run.from) || a.index - b.index);
  for (const { run, index } of order) {
    if (spent >= budget) break;
    for (const dir of [1, -1] as const) {
      const gap = dir === 1 ? lastPaved(run) + 1 : firstPaved(run) - 1;
      const inside = gap - dir, outside = gap + dir;
      const here = tierAt(board, run, inside), there = tierAt(board, run, outside);
      const mid = tierAt(board, run, gap);
      if (here < 0 || there < 0 || mid < 0 || here === there) continue;
      // Which cell the first ramp reads its cliff from: the HIGH ground's own edge cell, which is the
      // unpavable gap where the gap belongs to the high side and the cell beyond it where it does not.
      const down: 1 | -1 = here > there ? dir : (dir === 1 ? -1 : 1);
      const step = here > there
        ? (mid === here ? gap : inside)
        : (mid === there ? gap : outside);
      const flight = buildFlight(board, streets, {
        street: index, axis: run.axis, line: run.line, entry: true,
        across: acrossOf(run), span: run.width, down, step,
        highTier: Math.max(here, there), lowTier: Math.min(here, there),
        weight: run.to - run.from,
      }, styles, salt);
      if (!flight || spent + flight.ramps.length > budget) continue;
      commitFlight(board, flight);
      out.push(flight);
      spent += flight.ramps.length;
    }
  }
  return out;
}

/**
 * The OPPORTUNITY flights: every remaining step between two real streets, while the budget lasts.
 *
 * The spanning growth answers "how few ramps make this one network"; this pass answers the other
 * question — where a street runs into a terrace step and a ramp is legal and would join two stretches of
 * street, one should stand. A walker meeting a cliff between two roads does not care that there is a way
 * round. The style target climbs its terraces fifty-one times; the spanning growth alone buys nought to
 * seven.
 *
 * Bounded three ways, so this is generosity and not litter: the same ramp budget, both stretches long
 * enough to be streets rather than stubs, and the runway test that refuses any step whose corridor
 * would cross somebody else's pavement.
 */
function planOpportunities(
  board: Board, streets: readonly StreetRun[], styles: readonly RampStyle[], salt: number,
  budget: number,
): RampFlight[] {
  const out: RampFlight[] = [];
  if (budget <= 0) return out;
  let spent = 0;
  const candidates = findCandidates(board, streets)
    .filter((c) => c.weight >= OPPORTUNITY_MIN_RUN)
    .sort((a, b) => b.weight - a.weight || a.street - b.street || a.step - b.step);
  for (const candidate of candidates) {
    if (spent >= budget) break;
    const flight = buildFlight(board, streets, candidate, styles, salt);
    if (!flight || spent + flight.ramps.length > budget) continue;
    commitFlight(board, flight);
    out.push(flight);
    spent += flight.ramps.length;
  }
  return out;
}

/**
 * Where the movement line steps over water.
 *
 * The site is read off the SETTLED pavement, and the test is the one that keeps the map safe: cut the
 * gap, and both banks must still be pavement the plaza reaches without it. So a deck that fails to
 * land — the traits resolve a bridge themselves, and a span is refused where the banks are not level
 * — costs the map a crossing and never a network. What the deck buys is the crossing a walker wants at
 * the point they want it.
 *
 * Only ground-level stretches are offered: a bridge's two ends must be flat and equal, and the deck
 * scan in the pipeline reads water at elevation 0.
 */
function planCrossings(
  board: Board, streets: readonly StreetRun[], flights: readonly RampFlight[], budget: number,
): LineCrossing[] {
  const out: LineCrossing[] = [];
  if (budget <= 0) return out;
  const order = streets
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run.primary || run.rank === 'trunk')
    .sort((a, b) => Number(!!b.run.primary) - Number(!!a.run.primary)
      || (b.run.to - b.run.from) - (a.run.to - a.run.from) || a.index - b.index);
  for (const { run } of order) {
    if (out.length >= budget) break;
    const site = crossingSite(board, streets, flights, run, out);
    if (site) out.push(site);
  }
  return out;
}

/** The middle-most stretch of one run that may be given over to water, or null. */
function crossingSite(
  board: Board, streets: readonly StreetRun[], flights: readonly RampFlight[], run: StreetRun,
  taken: readonly LineCrossing[],
): LineCrossing | null {
  const lo = firstPaved(run) + CROSSING_INSET;
  const hi = lastPaved(run) - CROSSING_INSET - CROSSING_GAP;
  const mid = (lo + hi) / 2;
  const offsets: number[] = [];
  for (let t = lo; t <= hi; t++) offsets.push(t);
  offsets.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  for (const at of offsets) {
    const gap = alongRect(run.axis, acrossOf(run), run.width, at, at + CROSSING_GAP - 1);
    if (taken.some((c) => rectsTouch(c.gap, gap, CROSSING_APART))) continue;
    const tier = crossingGround(board, gap);
    if (tier < 0) continue;
    if (!cuttable(board, streets, flights, gap, run)) continue;
    const open = run.axis === 'y'
      ? { x: gap.x, y: gap.y + 1, w: gap.w, h: CROSSING_SPAN }
      : { x: gap.x + 1, y: gap.y, w: CROSSING_SPAN, h: gap.h };
    return {
      kind: tier === 0 ? 'water' : 'gorge', gap, open, tier, axis: run.axis, span: CROSSING_SPAN,
    };
  }
  return null;
}

/** The across-coordinate of a run's pavement: the low edge of its stamp. */
function acrossOf(run: StreetRun): number {
  const s = stampOf(
    run.axis === 'y' ? run.line : run.from, run.axis === 'y' ? run.from : run.line, run.width,
  );
  return run.axis === 'y' ? s.x : s.y;
}

/** The tier a would-be crossing stands at, or -1 where the ground will not take one: the run's own
 *  pavement, all of it and its surrounding ring at ONE tier so both banks come out level, and a cell
 *  of land either side of the gap for the deck's ends to rest on. */
function crossingGround(board: Board, gap: Rect): number {
  let tier = -1;
  for (let y = gap.y - 1; y <= gap.y + gap.h; y++) {
    for (let x = gap.x - 1; x <= gap.x + gap.w; x++) {
      if (x < 1 || y < 1 || x >= board.W - 1 || y >= board.H - 1) return -1;
      const i = flatIndex(x, y, board.W);
      if (!board.land[i] || board.reserved[i]) return -1;
      if (inRect(board.plaza, x, y)) return -1;
      if (tier < 0) tier = board.tier[i]!;
      else if (board.tier[i] !== tier) return -1;
    }
  }
  for (let y = gap.y; y < gap.y + gap.h; y++) {
    for (let x = gap.x; x < gap.x + gap.w; x++) if (!board.paved[flatIndex(x, y, board.W)]) return -1;
  }
  return tier;
}

/**
 * Whether the gap may be taken out of the pavement: with it gone, both banks are still street the
 * plaza reaches.
 *
 * The board is written and put back, which is what makes this a question rather than a decision — a
 * site that fails leaves the pavement exactly as it was.
 */
function cuttable(
  board: Board, streets: readonly StreetRun[], flights: readonly RampFlight[], gap: Rect, run: StreetRun,
): boolean {
  const cells: number[] = [];
  for (let y = gap.y; y < gap.y + gap.h; y++) {
    for (let x = gap.x; x < gap.x + gap.w; x++) cells.push(flatIndex(x, y, board.W));
  }
  for (const i of cells) { board.reserved[i] = 1; board.stopAt[i] = 1; }
  restamp(board, streets);
  const reach = reachable(board, flights);
  const along = run.axis === 'y' ? gap.y : gap.x;
  const ok = [along - 1, along + CROSSING_GAP].every((t) => bankReached(board, run, t, reach));
  if (!ok) {
    for (const i of cells) { board.reserved[i] = 0; board.stopAt[i] = 0; }
    restamp(board, streets);
  }
  return ok;
}

/** Whether the run's pavement at `t` along is street the plaza reaches. */
function bankReached(board: Board, run: StreetRun, t: number, reach: Uint8Array): boolean {
  const across = acrossOf(run);
  for (let k = 0; k < run.width; k++) {
    const x = run.axis === 'y' ? across + k : t;
    const y = run.axis === 'y' ? t : across + k;
    if (x < 0 || y < 0 || x >= board.W || y >= board.H) return false;
    if (reach[flatIndex(x, y, board.W)]) return true;
  }
  return false;
}

const rectsTouch = (a: Rect, b: Rect, pad: number): boolean =>
  a.x - pad < b.x + b.w && b.x < a.x + a.w + pad && a.y - pad < b.y + b.h && b.y < a.y + a.h + pad;

/** Whether a walker can step onto the block from a street without climbing: pavement at the block's
 *  own tier beside it, or a flight corridor already reaching it. */
function enteredOnTheLevel(board: Board, block: District): boolean {
  for (const i of block.cells) {
    const x = i % board.W, y = (i / board.W) | 0;
    const tier = board.tier[i]!;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= board.W || ny >= board.H) continue;
      const j = flatIndex(nx, ny, board.W);
      if (board.reserved[j]) return true;
      if (board.paved[j] && board.tier[j] === tier) return true;
    }
  }
  return false;
}

/** Where a block could be climbed into from the street below it, best-placed first: the flight wants
 *  to stand in the MIDDLE of the frontage it opens rather than at a corner of it. */
function entryCandidates(board: Board, block: District): FlightCandidate[] {
  const out: FlightCandidate[] = [];
  const seen = new Set<string>();
  for (const i of block.cells) {
    const x = i % board.W, y = (i / board.W) | 0;
    for (const [dx, dy] of NB4) {
      // The gap cell the flat trait leaves, and the street's pavement one further out.
      const gx = x + dx, gy = y + dy;
      const px = x + 2 * dx, py = y + 2 * dy;
      if (px < 0 || py < 0 || px >= board.W || py >= board.H) continue;
      const gap = flatIndex(gx, gy, board.W), pave = flatIndex(px, py, board.W);
      if (board.paved[gap] || !board.land[gap] || !board.paved[pave]) continue;
      const street = board.owner[pave]!;
      if (street < 0) continue;
      const here = board.tier[i]!, mid = board.tier[gap]!, there = board.tier[pave]!;
      if (here === there) continue;
      const axis: 'x' | 'y' = dx !== 0 ? 'x' : 'y';
      const walk = dx + dy;
      // Which cell the first ramp reads its cliff from: the HIGH plate's own edge cell, walking down
      // the step. The unpavable gap belongs to whichever plate the flat trait's window falls on, so
      // the tiers say where the boundary is rather than the direction the block was approached from.
      const along = (v: number): number => (axis === 'x' ? v % board.W : (v / board.W) | 0);
      const step = here > there
        ? along(mid === there ? i : gap)
        : along(mid === there ? gap : pave);
      const down: 1 | -1 = (here > there ? walk : -walk) > 0 ? 1 : -1;
      const line = axis === 'x' ? y : x;
      const key = `${axis}|${line}|${step}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        street, axis, line, entry: true,
        // Two cells across: the ramp is the only thing standing in an entry corridor, so the widest
        // ramp the catalog carries fits, and a map that drew no 1-wide style can still build one.
        across: line, span: 2, down, step,
        highTier: Math.max(here, there), lowTier: Math.min(here, there),
        weight: block.cells.length,
      });
    }
  }
  // Nearest the middle of the block first: an entry at a corner opens the same block through the
  // longest walk inside it.
  const cx = block.rect.x + block.rect.w / 2, cy = block.rect.y + block.rect.h / 2;
  return out.sort((a, b) => middle(a, cx, cy) - middle(b, cx, cy));
}

function middle(c: FlightCandidate, cx: number, cy: number): number {
  const x = c.axis === 'x' ? c.step : c.line;
  const y = c.axis === 'x' ? c.line : c.step;
  return Math.abs(x - cx) + Math.abs(y - cy);
}

/** The street an entry flight climbs off: whichever run's pavement stands against the foot of its
 *  corridor. -1 where the pruning took that street back, which retires the flight with it. */
function runCutBy(board: Board, flight: RampFlight): number {
  const r = flight.corridor;
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H || inRect(r, x, y)) continue;
      const i = flatIndex(x, y, board.W);
      if (board.paved[i] && board.owner[i]! >= 0) return board.owner[i]!;
    }
  }
  return -1;
}

/** The pavement components the plaza itself stands against: the network the hub already walks. */
function plazaComponents(board: Board, comp: Int32Array): Set<number> {
  const out = new Set<number>();
  const p = board.plaza;
  for (let y = p.y - 1; y <= p.y + p.h; y++) {
    for (let x = p.x - 1; x <= p.x + p.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      const i = flatIndex(x, y, board.W);
      if (board.paved[i]) out.add(comp[i]!);
    }
  }
  return out;
}

/** The along-coordinate just outside the flight's corridor: `-1` the high side, `1` the low one. */
function endOf(flight: RampFlight, c: FlightCandidate, side: -1 | 1): number {
  const r = flight.corridor;
  const lo = (c.axis === 'y' ? r.y : r.x) - 1;
  const hi = (c.axis === 'y' ? r.y + r.h : r.x + r.w);
  return (side === -1) === (c.down === 1) ? lo : hi;
}

/**
 * Every step a street's pavement stops at with more of the same street on the far side.
 *
 * The two pieces are read by their PAVEMENT, not by their skeletons. A skeleton stands `w` cells
 * clear of a step (its whole stamp has to be pavable and the flat trait forbids the cell before the
 * step), but the stamp reaches one cell past the skeleton either way, so whatever the width, the two
 * pieces of one line leave exactly ONE unpaved cell between them — the cell the ramp reads its cliff
 * from. That cell belongs to the HIGH plate where the street descends along the axis and to the LOW
 * one where it climbs, which is why the step cell is the gap going down and the gap's far neighbour
 * going up.
 */
function findCandidates(board: Board, streets: readonly StreetRun[]): FlightCandidate[] {
  const out: FlightCandidate[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < streets.length; index++) {
    const run = streets[index]!;
    const gap = lastPaved(run) + 1;
    for (const other of streets) {
      if (other.axis !== run.axis || other.line !== run.line) continue;
      if (firstPaved(other) !== gap + 1) continue;
      const hereTier = tierAt(board, run, gap - 1);
      const thereTier = tierAt(board, other, gap + 1);
      if (hereTier < 0 || thereTier < 0 || hereTier === thereTier) continue;
      const key = `${run.axis}|${run.line}|${gap}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const down: 1 | -1 = hereTier > thereTier ? 1 : -1;
      const stamp = stampOf(
        run.axis === 'y' ? run.line : gap, run.axis === 'y' ? gap : run.line, run.width,
      );
      out.push({
        street: index, axis: run.axis, line: run.line, entry: false,
        across: run.axis === 'y' ? stamp.x : stamp.y, span: run.width, down,
        step: down === 1 ? gap : gap + 1,
        highTier: Math.max(hereTier, thereTier), lowTier: Math.min(hereTier, thereTier),
        weight: Math.min(run.to - run.from, other.to - other.from),
      });
    }
  }
  return out;
}

/** The along-coordinates a run's PAVEMENT covers: the stamp reaches one cell past the skeleton at
 *  each end, whether the width is odd (centred) or even (down-right of the skeleton). */
function firstPaved(run: StreetRun): number { return run.from - ((run.width - 1) >> 1); }
function lastPaved(run: StreetRun): number { return run.to + run.width - 1 - ((run.width - 1) >> 1); }

function tierAt(board: Board, run: StreetRun, t: number): number {
  const x = run.axis === 'y' ? run.line : t;
  const y = run.axis === 'y' ? t : run.line;
  if (x < 0 || y < 0 || x >= board.W || y >= board.H) return -1;
  return board.tier[flatIndex(x, y, board.W)]!;
}

/**
 * The flight itself: one ramp per tier, stepping four cells of run each, plus the landings between
 * them.
 *
 * The heightDrop trait resolves a ramp from the cliff it finds, and the two facings it resolves to
 * are not symmetric: a ramp facing +y or +x stores its footprint FROM the high cell (the high row is
 * under the ramp), one facing -y or -x stores it from four cells back (the high row is not). The
 * geometry here is written the trait's way so the footprint in the plan is the footprint the engine
 * will hold, which is what makes the no-pavement-under-a-ramp promise checkable.
 */
function buildFlight(
  board: Board, streets: readonly StreetRun[], c: FlightCandidate, styles: readonly RampStyle[], salt: number,
): RampFlight | null {
  const tiers = c.highTier - c.lowTier;
  const fits = styles.filter((s) => s.width <= c.span);
  const item = fits[Math.floor(hash01(salt ^ c.street, c.step) * fits.length)];
  if (!item) return null;
  const width = item.width;
  // The CORRIDOR is one cell wider than the ramp where the street itself is not: a whole-anchored
  // footprint is read by the trait one cell past its own width (terrain renders half a cell up-left),
  // and every cell the trait reads has to be terrace the sculptor may carve, not somebody's pavement.
  const across = c.across;
  const spread = Math.max(c.span, width + 1);

  const ramps: RampSpec[] = [];
  const landings: { rect: Rect; tier: number }[] = [];
  for (let k = 0; k < tiers; k++) {
    // The high cell of this step, walking down the flight.
    const high = c.step + c.down * RAMP_RUN * k;
    const low0 = high + c.down;
    const lowLast = high + c.down * RAMP_RUN;
    const highTier = c.highTier - k;
    // The trait reads the high cell plus the whole run below it, so the ground it needs is one cell
    // longer than the footprint.
    const lo = Math.min(high, lowLast), hi = Math.max(high, lowLast);
    if (!clearRunway(board, streets, c, across, spread, lo, hi)) return null;
    ramps.push(rampSpec(c.axis, c.down, across, high, width, item.id, highTier));
    // The last flight of steps lands on the low plate's own surface; every one before it lands on a
    // terrace the sculptor carves.
    if (k < tiers - 1) {
      landings.push({
        rect: alongRect(c.axis, across, spread, Math.min(low0, lowLast), Math.max(low0, lowLast)),
        tier: highTier - 1,
      });
    }
  }
  if (!landsOnTheLowPlate(board, c, across, spread, tiers)) return null;
  const along = ramps.flatMap((r) => (c.axis === 'y'
    ? [r.footprint.y, r.footprint.y + r.footprint.h - 1]
    : [r.footprint.x, r.footprint.x + r.footprint.w - 1]));
  return {
    street: c.street, entry: c.entry, axis: c.axis, highTier: c.highTier, lowTier: c.lowTier,
    corridor: alongRect(c.axis, across, spread, Math.min(...along), Math.max(...along)),
    ramps, landings,
  };
}

/** Does the bottom of the flight stand on the low plate's own surface? Every ramp above the last one
 *  lands on a terrace the sculptor carves, but the last one has nothing under it to carve: its run
 *  has to be the plate the street continues on, or the flight ends in mid-air. */
function landsOnTheLowPlate(
  board: Board, c: FlightCandidate, across: number, spread: number, tiers: number,
): boolean {
  const last = c.step + c.down * RAMP_RUN * (tiers - 1);
  const rect = alongRect(
    c.axis, across, spread,
    Math.min(last + c.down, last + c.down * RAMP_RUN), Math.max(last + c.down, last + c.down * RAMP_RUN),
  );
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) return false;
      if (board.tier[flatIndex(x, y, board.W)] !== c.lowTier) return false;
    }
  }
  return true;
}

/** A rect covering the street's whole width across, and `[lo, hi]` along. */
function alongRect(axis: 'x' | 'y', across: number, width: number, lo: number, hi: number): Rect {
  return axis === 'y'
    ? { x: across, y: lo, w: width, h: hi - lo + 1 }
    : { x: lo, y: across, w: hi - lo + 1, h: width };
}

/** One ramp, positioned and rotated the way the heightDrop trait resolves the cliff it stands at. */
function rampSpec(
  axis: 'x' | 'y', down: 1 | -1, across: number, high: number, width: number,
  catalogId: string, elevation: number,
): RampSpec {
  // Descending as the along-coordinate grows: the ramp faces +y (or +x) and its footprint starts at
  // the high cell. Descending the other way it faces -y (-x) and its footprint ends one short of it.
  const rotation: 0 | 90 | 180 | 270 = axis === 'y' ? (down === 1 ? 0 : 180) : (down === 1 ? 90 : 270);
  const startAlong = down === 1 ? high : high - RAMP_RUN;
  const position = axis === 'y' ? { x: across, y: startAlong } : { x: startAlong, y: across };
  const footprint = axis === 'y'
    ? { x: across, y: startAlong, w: width, h: RAMP_RUN }
    : { x: startAlong, y: across, w: RAMP_RUN, h: width };
  return { catalogId, position, rotation, elevation, footprint };
}

/**
 * Whether the ground the flight needs is there to take.
 *
 * The tiers under it are the sculptor's to carve, so what is read here is the planet, the plaza and
 * what other flights already claimed — plus one thing the geometry cannot fix afterwards: pavement
 * belonging to a street on ANOTHER line. A flight crossing one of those would put a ramp on a road,
 * and erasing the road instead would leave a hole in the middle of a street. Such a candidate is
 * refused and the district it would have served waits for another street's flight.
 */
function clearRunway(
  board: Board, streets: readonly StreetRun[], c: FlightCandidate,
  across: number, spread: number, lo: number, hi: number,
): boolean {
  const rect = alongRect(c.axis, across, spread, lo, hi);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) return false;
      const i = flatIndex(x, y, board.W);
      if (!board.land[i] || board.reserved[i] || inRect(board.plaza, x, y)) return false;
      // A flight belongs to the two plates it joins. Where a third one crosses the runway higher
      // than the flight's own top or lower than its foot, the terrace the sculptor would have to
      // carve is not between the two surfaces the ramps run on.
      const t = board.tier[i]!;
      if (t < c.lowTier || t > c.highTier) return false;
      const owner = board.owner[i]!;
      if (!board.paved[i] || owner < 0) continue;
      // An entry flight cuts the street it climbs off, and only that one. An inline flight takes
      // back its own line's pavement and no other: a flight crossing a foreign street would put a
      // ramp on a road, and erasing the road instead would leave a hole in the middle of it.
      if (c.entry) { if (owner !== c.street) return false; continue; }
      const other = streets[owner]!;
      if (other.axis !== c.axis || other.line !== c.line) return false;
    }
  }
  return true;
}

/**
 * Clears the pavement out of a flight's corridor and reserves it, so nothing paves it later.
 *
 * The clearing is by CELL and not by stamp: a stamp is a `w x w` square, so erasing the skeleton
 * positions the corridor covers would take one more cell of the street beyond it — and that cell is
 * exactly where the street has to resume for the flight to carry anything.
 */
function commitFlight(board: Board, flight: RampFlight): void {
  const r = flight.corridor;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      const i = flatIndex(x, y, board.W);
      board.paved[i] = 0; board.owner[i] = -1; board.rankAt[i] = 0;
      board.reserved[i] = 1; board.stopAt[i] = 1;
    }
  }
  reserveMargin(board, flight);
}

/**
 * The corridor's DUAL-GRID MARGIN: the row above it and the column left of it.
 *
 * A coating at (x, y) is validated over (x, y), (x+1, y), (x, y+1) and the corner between them, so
 * pavement one cell north or west of the corridor is judged on ground the flight is about to carve
 * into a landing. Where that ground will not come out at the pavement's own tier, the cell is
 * reserved as well: the settling pass then splits the street around it, instead of the pipeline
 * laying a road the rules refuse. Ground that keeps its tier — the ramp's own high cells, the run
 * that lands on the low plate — is left alone, which is what keeps a street running up to a flight.
 */
function reserveMargin(board: Board, flight: RampFlight): void {
  const r = flight.corridor;
  const tierAtCell = (x: number, y: number): number => {
    for (const landing of flight.landings) {
      if (inRect(landing.rect, x, y)) return landing.tier;
    }
    return board.tier[flatIndex(x, y, board.W)]!;
  };
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 1 || y < 1 || x >= board.W || y >= board.H) continue;
      const level = tierAtCell(x, y);
      for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1]] as const) {
        const mx = x + dx, my = y + dy;
        if (inRect(r, mx, my)) continue;
        const m = flatIndex(mx, my, board.W);
        if (board.tier[m] === level) continue;
        board.paved[m] = 0; board.owner[m] = -1; board.rankAt[m] = 0;
        board.reserved[m] = 1;
      }
    }
  }
}

/** Connected components of the pavement: the detached pieces of street the flights join up. */
function componentsOf(board: Board): {
  comp: Int32Array;
  at(board: Board, c: FlightCandidate, along: number): number;
} {
  const N = board.W * board.H;
  const comp = new Int32Array(N).fill(-1);
  let count = 0;
  for (let s = 0; s < N; s++) {
    if (!board.paved[s] || comp[s]! >= 0) continue;
    const id = count++;
    const stack = [s]; comp[s] = id;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % board.W, y = (p / board.W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= board.W || ny >= board.H) continue;
        const j = flatIndex(nx, ny, board.W);
        if (!board.paved[j] || comp[j]! >= 0) continue;
        comp[j] = id; stack.push(j);
      }
    }
  }
  return {
    comp,
    /** The component of the pavement standing at `along` on the flight's line. */
    at(b, c, along) {
      const x = c.axis === 'y' ? c.line : along;
      const y = c.axis === 'y' ? along : c.line;
      if (x < 0 || y < 0 || x >= b.W || y >= b.H) return -1;
      const i = flatIndex(x, y, b.W);
      return b.paved[i] ? comp[i]! : -1;
    },
  };
}

/**
 * Cells the plaza reaches over pavement, with a flight's ramps conducting between its two ends.
 *
 * What conducts is each RAMP's own footprint dilated by one cell, not the corridor: the corridor can
 * be a cell wider than the ramps standing in it, and the evaluation's connectivity reading dilates
 * the footprints. Conducting over the wider rect would let this planner call a component reachable
 * that the ledger then reads as cut off from the plaza.
 */
function reachable(board: Board, flights: readonly RampFlight[]): Uint8Array {
  const N = board.W * board.H;
  const conduct = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (board.paved[i]) conduct[i] = 1;
  for (const flight of flights) {
    for (const ramp of flight.ramps) {
      const r = ramp.footprint;
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
          conduct[flatIndex(x, y, board.W)] = 1;
        }
      }
    }
  }
  const seen = new Uint8Array(N);
  const stack: number[] = [];
  // The plaza's own ring: any pavement touching the plaza rect.
  for (let y = board.plaza.y - 1; y <= board.plaza.y + board.plaza.h; y++) {
    for (let x = board.plaza.x - 1; x <= board.plaza.x + board.plaza.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      const i = flatIndex(x, y, board.W);
      if (conduct[i] && !seen[i]) { seen[i] = 1; stack.push(i); }
    }
  }
  // A HUB WITH NO ROOM FOR A STREET AGAINST IT still gets a network. Where the plaza's plate is
  // shaped so that no trunk can be laid along its ring, seeding from the ring alone prunes every
  // street on the planet — measured: one seed of sixty came back with no pavement at all. The
  // largest piece stands in for the hub then, and the pipeline paves the short course from the
  // plaza's own ring out to it, so the finished map is still one network the plaza reaches.
  if (stack.length === 0) {
    for (const i of largestPiece(board, conduct)) { seen[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % board.W, y = (p / board.W) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= board.W || ny >= board.H) continue;
      const j = flatIndex(nx, ny, board.W);
      if (!conduct[j] || seen[j]) continue;
      seen[j] = 1; stack.push(j);
    }
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (board.paved[i] && seen[i]) out[i] = 1;
  return out;
}

/** The largest 4-connected run of conducting cells, as flat indices. */
function largestPiece(board: Board, conduct: Uint8Array): number[] {
  const N = board.W * board.H;
  const seen = new Uint8Array(N);
  let best: number[] = [];
  for (let s = 0; s < N; s++) {
    if (!conduct[s] || seen[s]) continue;
    const cells: number[] = [];
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const x = p % board.W, y = (p / board.W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= board.W || ny >= board.H) continue;
        const j = flatIndex(nx, ny, board.W);
        if (!conduct[j] || seen[j]) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    if (cells.length > best.length) best = cells;
  }
  return best;
}

// --- tails ---------------------------------------------------------------------------------------

/**
 * NO STREET ENDS AT NOTHING (不留断头路), read the way a person reads it.
 *
 * `trimTails` cuts a tail back to the last CROSSING, which is the rule as the network sees it. This is
 * the rule as a walker sees it, and the two are not the same: a street whose last crossing is one cell
 * from its tip passes the first and still stops dead in open grass, on a map whose tip-cell count reads
 * zero.
 *
 * So each end is walked inward until the pavement ARRIVES: the coast or the map's edge, the plaza,
 * or a flight's corridor or a crossing's channel, where the way on is the ramp or the deck. What
 * cannot arrive is erased, and a run cut below a street's own length goes entirely. Read on the
 * PLAN, so it is blind to what stage C will compose at the end of a path — which makes it
 * conservative rather than wrong: a street cut back from a garden it would have arrived at is a
 * shorter street, and one left running into open ground is a dead end.
 */
function trimToArrivals(board: Board, streets: StreetRun[]): void {
  for (let index = 0; index < streets.length; index++) {
    const run = streets[index]!;
    for (const end of [1, -1] as const) {
      // THE CUT IS BOUNDED, and the bound is a TOTAL over the whole settling (`StreetRun.eroded`).
      // A street that cannot arrive within `TRIM_MAX` cells of its tip is not a stub running into
      // open grass, it is a long street running out at a plate edge.
      const eroded = run.eroded ?? (run.eroded = [0, 0]);
      const side = end === 1 ? 1 : 0;
      for (let guard = eroded[side]!; guard < TRIM_MAX; guard++) {
        const tip = end === 1 ? run.to : run.from;
        if (run.to < run.from) break;
        if (arrivesFrom(board, streets, run, tip, end, index)) break;
        // A STREET MAY END AT NOTHING AND STILL BE SOMEBODY'S ONLY FRONTAGE, and the two wants
        // compose rather than trade: the ground beside a street's last cells is what the block there
        // is fronted by. So the cut is only taken where that ground stays served without the cells
        // being erased — where the end is a spare stub, not the last pavement a block has.
        if (!flanksServed(board, run, tip)) break;
        eroded[side] = eroded[side]! + 1;
        if (end === 1) { erase(board, run, index, run.to, run.to); run.to--; }
        else { erase(board, run, index, run.from, run.from); run.from++; }
      }
    }
  }
}

/**
 * Whether the open ground beside the street at `tip` would still be served once the tip is erased.
 *
 * This is the exact reading `cutDistricts` makes of a block — pavement or a flight corridor
 * 4-adjacent to it — asked of the cells the cut would leave bare, and asked against everything
 * except THE CELLS BEING ERASED. The rest of the run goes on running beside the same block, so
 * excluding the whole run would refuse a street its own tidy-up on the grounds that it is itself
 * the frontage a few cells further along.
 */
function flanksServed(board: Board, run: StreetRun, tip: number): boolean {
  const s = stampOf(
    run.axis === 'y' ? run.line : tip, run.axis === 'y' ? tip : run.line, run.width,
  );
  for (let y = s.y - 1; y <= s.y + s.h; y++) {
    for (let x = s.x - 1; x <= s.x + s.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      const i = flatIndex(x, y, board.W);
      if (!board.land[i] || board.paved[i] || board.reserved[i]) continue;
      let served = false;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= board.W || ny >= board.H) continue;
        if (inRect(s, nx, ny)) continue;
        const j = flatIndex(nx, ny, board.W);
        if (board.reserved[j] || board.paved[j]) { served = true; break; }
      }
      if (!served) return false;
    }
  }
  return true;
}

/**
 * Whether the run's pavement at `tip`, looking outward along `end`, reaches something a walk arrives
 * at within `ARRIVE_REACH`: the coast, the map's edge, the plaza, a flight's corridor, a crossing's
 * channel — or ANOTHER STREET, which is the junction grammar's own answer.
 *
 * A street that stops against another street has arrived: it is a T-junction, and a T is what the
 * supplement asks the network to be made of. Without this reading a staggered leg would be eroded
 * off the very street it steps across at, and the two halves of one line would part company.
 *
 * The street test starts AT the tip and not ahead of it: a leg laid up to a crossing ends INSIDE the
 * crossing street's band, and the cells it stands on there belong to that street rather than to it.
 */
function arrivesFrom(
  board: Board, runs: readonly StreetRun[], run: StreetRun, tip: number, end: 1 | -1, index: number,
): boolean {
  if (meetsStreet(board, runs, run, tip, end, index, 0, JOIN_LEFT) > 0) return true;
  const s = stampOf(
    run.axis === 'y' ? run.line : tip, run.axis === 'y' ? tip : run.line, run.width,
  );
  const across = run.axis === 'y' ? s.x : s.y;
  const along = run.axis === 'y' ? s.y + (end === 1 ? s.h - 1 : 0) : s.x + (end === 1 ? s.w - 1 : 0);
  for (let k = 1; k <= ARRIVE_REACH; k++) {
    for (let a = -1; a <= run.width; a++) {
      const at = along + end * k;
      const x = run.axis === 'y' ? across + a : at;
      const y = run.axis === 'y' ? at : across + a;
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) return true;
      const i = flatIndex(x, y, board.W);
      if (!board.land[i]) return true;
      if (board.stopAt[i] || inRect(board.plaza, x, y)) return true;
    }
  }
  return false;
}

/**
 * How far ahead of the run's tip, along `end`, the street it was HEADING FOR stands: 0 where none
 * does within `reach`.
 *
 * "Heading for" is the junction test and not merely a proximity one. The pavement has to lie
 * STRAIGHT AHEAD of the tip's own stamp — a street the tip merely passes beside is not one it meets
 * — and it has to belong either to a street of the other axis (the T) or to another piece of this
 * very line (a street the ground cut in two). Every cell between has to be ground this street could
 * legally have been laid on, so the answer is a gap that can actually be closed.
 */
function meetsStreet(
  board: Board, runs: readonly StreetRun[], run: StreetRun, tip: number, end: 1 | -1,
  index: number, first: number, reach: number, live?: Uint8Array,
): number {
  for (let k = first; k <= reach; k++) {
    const t = tip + end * k;
    const x = run.axis === 'y' ? run.line : t;
    const y = run.axis === 'y' ? t : run.line;
    const s = stampOf(x, y, run.width);
    if (s.x < 0 || s.y < 0 || s.x + s.w > board.W || s.y + s.h > board.H) return 0;
    for (let cy = s.y; cy < s.y + s.h; cy++) {
      for (let cx = s.x; cx < s.x + s.w; cx++) {
        const i = flatIndex(cx, cy, board.W);
        const owner = board.owner[i]!;
        if (owner < 0 || owner === index) continue;
        const other = runs[owner];
        if (!other) continue;
        if (other.axis === run.axis && other.line !== run.line) continue;
        // FOR THE JOIN, the target has to be pavement the plaza can already walk to. Gluing two
        // orphans together closes no gap, and the settling then takes the extension back for being
        // unreachable and lays it again on the next pass, for every pass the bound allows.
        if (live && !live[i]) continue;
        return k;
      }
    }
    // Ground the street could not be laid on stops the look: what is beyond it is not something this
    // street can reach by carrying on. The tip's own cells are pavement, so the gate starts past it.
    if (k > 0 && !skeletonLegal(board, x, y, run.width)) return 0;
  }
  return 0;
}

/**
 * THE NEAR-MISS JOIN: a street stopping two cells short of the one it was heading for.
 *
 * A terrace step leaves a one-cell gap in the pavable mask (the coating's own window reads the step),
 * so a street running at a tier seam can finish a cell or two before the street it aimed at and the
 * two never meet. The settling then reads the stub as unreachable pavement and prunes it, or leaves
 * it standing as the tip cells the connectivity ledger counts.
 *
 * THE NAIVE EXTENSION IS RULED OUT: extending every stub toward whatever is near it grows pavement into
 * places no street was going. The join is a JUNCTION decision instead —
 * `meetsStreet` answers only for a street straight ahead of the tip that this one could have run
 * into, and the extension is exactly the gap, so what is added is the T and nothing else.
 */
function joinNearMisses(board: Board, streets: StreetRun[], reach: Uint8Array): boolean {
  let joined = false;
  for (let index = 0; index < streets.length; index++) {
    const run = streets[index]!;
    if (run.to < run.from) continue;
    const done = run.joinedEnd ?? (run.joinedEnd = [false, false]);
    for (const end of [1, -1] as const) {
      const side = end === 1 ? 1 : 0;
      if (done[side]) continue;
      const tip = end === 1 ? run.to : run.from;
      const gap = meetsStreet(board, streets, run, tip, end, index, 2, JOIN_REACH, reach);
      if (gap < 2) continue;
      done[side] = true;
      if (end === 1) run.to += gap - 1; else run.from -= gap - 1;
      paint(board, run, index);
      joined = true;
    }
  }
  return joined;
}

/**
 * Trims a street's tail beyond its last junction (不留断头路).
 *
 * A tail is kept where it ends at the coast or at a flight, which are termini a walker understands.
 * A tail that simply stops in the middle of open ground is pavement leading nowhere, and it is cut
 * back to the crossing that last gave it a purpose.
 */
function trimTails(board: Board, streets: StreetRun[], flights: readonly RampFlight[]): void {
  const flightEnds = flightEndCells(flights);
  for (let index = 0; index < streets.length; index++) {
    const run = streets[index]!;
    for (const end of [1, -1] as const) {
      const tip = end === 1 ? run.to : run.from;
      if (run.to - run.from < PIECE_MIN) break;
      if (tipStops(board, run, tip, end, flightEnds)) continue;
      const junction = lastJunction(board, run, index, end, flightEnds);
      const tail = end === 1 ? run.to - junction : junction - run.from;
      if (tail <= TAIL_MAX) continue;
      if (end === 1) { erase(board, run, index, junction + 1, run.to); run.to = junction; }
      else { erase(board, run, index, run.from, junction - 1); run.from = junction; }
    }
  }
}

/** The cells a flight's corridor and its own ring cover: where a street may stop because a ramp
 *  carries the walk on. */
function flightEndCells(flights: readonly RampFlight[]): Set<string> {
  const out = new Set<string>();
  for (const f of flights) {
    const r = f.corridor;
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) out.add(`${x},${y}`);
    }
  }
  return out;
}

/** Does the run's tip end somewhere a street may legitimately stop: at the coast, at the map edge,
 *  against a flight, or at the PLAZA — the hub is a destination like any other, and a trunk laid
 *  along its ring is the shortest street on the map that is certainly going somewhere. Without this
 *  a hub whose four trunks are cut into pieces that never meet reads as four tails, they are all
 *  trimmed, and then every street on the planet is pruned for being unreachable from a plaza no
 *  pavement touches (measured on one seed of sixty: 20 runs laid, 0 kept). */
function tipStops(
  board: Board, run: StreetRun, tip: number, end: 1 | -1, flightEnds: ReadonlySet<string>,
): boolean {
  const t = tip + end;
  const x = run.axis === 'y' ? run.line : t;
  const y = run.axis === 'y' ? t : run.line;
  if (x < 0 || y < 0 || x >= board.W || y >= board.H) return true;
  if (flightEnds.has(`${x},${y}`)) return true;
  // A flight's corridor and a crossing's channel are both places a walker understands a street
  // stopping at: the way on is the ramp or the deck standing in them.
  if (board.stopAt[flatIndex(x, y, board.W)]) return true;
  if (touchesPlaza(board, run, tip)) return true;
  const s = stampOf(x, y, run.width);
  for (let cy = s.y; cy < s.y + s.h; cy++) {
    for (let cx = s.x; cx < s.x + s.w; cx++) {
      if (cx < 0 || cy < 0 || cx >= board.W || cy >= board.H) return true;
      if (!board.land[flatIndex(cx, cy, board.W)]) return true;
    }
  }
  return false;
}

/** Whether the run's stamp at `t` stands against the plaza's own ring. */
function touchesPlaza(board: Board, run: StreetRun, t: number): boolean {
  const x = run.axis === 'y' ? run.line : t;
  const y = run.axis === 'y' ? t : run.line;
  const s = stampOf(x, y, run.width);
  const p = board.plaza;
  return s.x <= p.x + p.w && p.x <= s.x + s.w && s.y <= p.y + p.h && p.y <= s.y + s.h;
}

/** The last point along the run, walking in from `end`, where another street's pavement meets it or
 *  a flight climbs off it. A flight counts because it is a crossing like any other: trimming back
 *  past one would cut the terrace above it off the network. */
function lastJunction(
  board: Board, run: StreetRun, index: number, end: 1 | -1, flightEnds: ReadonlySet<string>,
): number {
  const first = end === 1 ? run.to : run.from, last = end === 1 ? run.from : run.to;
  for (let t = first; end === 1 ? t >= last : t <= last; t -= end) {
    const x = run.axis === 'y' ? run.line : t;
    const y = run.axis === 'y' ? t : run.line;
    const s = stampOf(x, y, run.width);
    for (let cy = s.y - 1; cy <= s.y + s.h; cy++) {
      for (let cx = s.x - 1; cx <= s.x + s.w; cx++) {
        if (cx < 0 || cy < 0 || cx >= board.W || cy >= board.H) continue;
        const i = flatIndex(cx, cy, board.W);
        if (flightEnds.has(`${cx},${cy}`) || board.stopAt[i]) return t;
        if (board.paved[i] && board.owner[i] !== index) return t;
      }
    }
  }
  return end === 1 ? run.from : run.to;
}

// --- settling --------------------------------------------------------------------------------------

/**
 * The plan the board actually holds, after the flights and the trimming have taken pavement back.
 *
 * Pruning is done by REBUILDING rather than by rubbing out. Erasing single cells leaves slivers — a
 * crossing street's cells stay behind where the run that owned them went, and a sliver is a 1-wide
 * road, which is the one width the rank hierarchy forbids. So each pass keeps the stretches of each run
 * whose whole stamp is still pavable, unreserved and reachable from the plaza, drops what is left shorter
 * than a street, and stamps the board again from that list: every paved cell is inside a full
 * `w x w` stamp by construction, exactly as it was when the lines were first laid.
 *
 * It is a fixpoint because the three facts feed each other: dropping a run can strand the pieces it
 * carried, and a flight whose street no longer arrives at both ends gives its corridor back, which
 * can strand another. Four passes is well past what a map takes to stop moving.
 *
 * EVERY REASON A FLIGHT CAN BE RETIRED IS TESTED INSIDE THE LOOP, both that its street still arrives
 * and that the street can still be named. A flight retired after the last pass would give its
 * corridor back with nothing left to re-prune, and the pavement it was carrying would stand there
 * unreachable — the one hard-ledger failure this construction cannot otherwise produce.
 */
function settle(
  board: Board, streets: StreetRun[], flights: readonly RampFlight[],
): { streets: StreetRun[]; flights: RampFlight[] } {
  let runs: StreetRun[] = streets;
  let live: RampFlight[] = [...flights];
  // WHY THE LOOP ENDS. Two of the three things a pass does only ever REMOVE — the trims take
  // pavement off an end, the pruning drops a run or a flight — and both are bounded below by an
  // empty map. The third, the near-miss join, ADDS pavement; it terminates on its own count instead,
  // since an end is offered a join exactly once (`StreetRun.joinedEnd`), so there are at most two
  // joins per run over the whole settling however many passes it takes. A pass that joined is not a
  // settled pass, and a pass that left pavement the plaza cannot walk to is not either: STABILITY IS
  // BOTH, which is what the `stranded` term below is for. The bound is a safety net scaled to what
  // there is to remove and to join, not the expected count: maps settle in one or two passes.
  const passes = 2 * (streets.length + flights.length) + 4;
  for (let pass = 0; pass < passes; pass++) {
    // THE JOIN COMES BEFORE THE TRIMS. A stub two cells short of the street it aimed at is a dead end
    // to both of them, so closing it first is what stops the trimming from cutting back a street that
    // was about to arrive.
    const joined = joinNearMisses(board, runs, reachable(board, live));
    trimTails(board, runs, live);
    trimToArrivals(board, runs);
    const trimmed = runs.filter((r) => r.to - r.from >= PIECE_MIN - 1);
    restamp(board, trimmed);
    const pruned = prune(board, trimmed, live);
    restamp(board, pruned);
    const kept = live.filter((f) => flightIsUsed(board, f) && streetOfFlight(board, pruned, f) >= 0);
    for (const f of live) if (!kept.includes(f)) freeCorridor(board, f);
    // A PASS IS SETTLED WHEN IT CHANGED NOTHING AND LEFT NOTHING STRANDED.
    //
    // The join runs before the trims and mutates the run list in place, so the list comparison alone
    // sees its result as though it had always been there and the loop would break on the very pass
    // that changed the board. And `prune` judges reachability on the board as it stands BEFORE its
    // own removals, so a piece kept because a neighbour reached it can still be standing after that
    // neighbour was taken back in the same pass. Reading the board it actually leaves is what closes
    // both: measured, one seed of sixty finished carrying a bend's link with both its legs gone.
    const stable = !joined && stranded(board, kept) === 0
      && pruned.length === runs.length && kept.length === live.length
      && pruned.every((r, i) => r.from === runs[i]!.from && r.to === runs[i]!.to);
    runs = pruned; live = kept;
    if (stable) break;
  }
  restamp(board, runs);
  return {
    streets: runs,
    flights: live.map((flight) => ({ ...flight, street: streetOfFlight(board, runs, flight) })),
  };
}

/** Paved cells the plaza cannot walk to on the board as it now stands. */
function stranded(board: Board, flights: readonly RampFlight[]): number {
  const reach = reachable(board, flights);
  let n = 0;
  for (let i = 0; i < board.W * board.H; i++) if (board.paved[i] && !reach[i]) n++;
  return n;
}

/** The stretches of each run that are still whole streets: stamp legal, and pavement the plaza
 *  reaches. A run whose middle went unreachable comes back as two. */
function prune(board: Board, runs: readonly StreetRun[], flights: readonly RampFlight[]): StreetRun[] {
  const reach = reachable(board, flights);
  const out: StreetRun[] = [];
  for (const run of runs) {
    let start = -1;
    for (let t = run.from; t <= run.to + 1; t++) {
      if (t <= run.to && stampReaches(board, run, t, reach)) { if (start < 0) start = t; continue; }
      if (start >= 0 && t - start >= PIECE_MIN) out.push({ ...run, from: start, to: t - 1 });
      start = -1;
    }
  }
  return out;
}

/** Is every cell of the run's stamp at `t` pavement the plaza can walk to? */
function stampReaches(board: Board, run: StreetRun, t: number, reach: Uint8Array): boolean {
  const x = run.axis === 'y' ? run.line : t;
  const y = run.axis === 'y' ? t : run.line;
  const s = stampOf(x, y, run.width);
  if (s.x < 0 || s.y < 0 || s.x + s.w > board.W || s.y + s.h > board.H) return false;
  for (let cy = s.y; cy < s.y + s.h; cy++) {
    for (let cx = s.x; cx < s.x + s.w; cx++) {
      const i = flatIndex(cx, cy, board.W);
      if (!board.pavable[i] || board.reserved[i] || !reach[i]) return false;
    }
  }
  return true;
}

/** Lays the board out again from a run list: the only writer of the pavement after the first pass. */
function restamp(board: Board, runs: readonly StreetRun[]): void {
  board.paved.fill(0);
  board.owner.fill(-1);
  board.rankAt.fill(0);
  for (let index = 0; index < runs.length; index++) paint(board, runs[index]!, index);
}

function freeCorridor(board: Board, flight: RampFlight): void {
  const r = flight.corridor;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      const i = flatIndex(x, y, board.W);
      board.reserved[i] = 0; board.stopAt[i] = 0;
    }
  }
}

/** The run the flight carries, after the pruning renumbered them: the street on the flight's own
 *  line whose pavement runs up to the corridor. -1 where none survived. */
function streetOfFlight(board: Board, runs: readonly StreetRun[], flight: RampFlight): number {
  if (flight.entry) return runCutBy(board, flight);
  const r = flight.corridor;
  const lo = (flight.axis === 'y' ? r.y : r.x) - 1;
  const hi = flight.axis === 'y' ? r.y + r.h : r.x + r.w;
  const line = flight.axis === 'y' ? r.x : r.y;
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index]!;
    if (run.axis !== flight.axis) continue;
    const s = stampOf(
      run.axis === 'y' ? run.line : run.from, run.axis === 'y' ? run.from : run.line, run.width,
    );
    const across = run.axis === 'y' ? s.x : s.y;
    if (across !== line) continue;
    if (lastPaved(run) === lo || firstPaved(run) === hi) return index;
  }
  return -1;
}

/** Does the flight still have the street it was built for: pavement at both ends of an inline one,
 *  and pavement anywhere against an entry, whose corridor runs ACROSS the street it climbs off (so
 *  what is left of that street stands beside the corridor, not beyond its ends). */
function flightIsUsed(board: Board, flight: RampFlight): boolean {
  const r = flight.corridor;
  let low = false, high = false;
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      if (inRect(r, x, y) || !board.paved[flatIndex(x, y, board.W)]) continue;
      if (flight.entry) return true;
      const along = flight.axis === 'y' ? y : x;
      if (along < (flight.axis === 'y' ? r.y : r.x)) low = true;
      else if (along >= (flight.axis === 'y' ? r.y + r.h : r.x + r.w)) high = true;
    }
  }
  return low && high;
}

// --- districts -------------------------------------------------------------------------------------

/**
 * The partition: connected pieces of open land, cut by the streets, by the flights and by the plate
 * edges — the same segmentation the evaluation reads off a finished map, computed here on the plan.
 *
 * A district is SERVED when a street or a flight the plaza reaches runs along it. That is what makes
 * the partition a town rather than a pattern: every block has a front on a street.
 */
function cutDistricts(board: Board, composition: CompositionPlan): District[] {
  const N = board.W * board.H;
  const open = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!board.land[i] || board.paved[i] || board.reserved[i]) continue;
    const x = i % board.W, y = (i / board.W) | 0;
    if (!inRect(board.plaza, x, y)) open[i] = 1;
  }
  const seen = new Uint8Array(N);
  const out: District[] = [];
  for (let s = 0; s < N; s++) {
    if (!open[s] || seen[s]) continue;
    const cells: number[] = [];
    const stack = [s]; seen[s] = 1;
    const plate = composition.plateOf[s]!;
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const x = p % board.W, y = (p / board.W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= board.W || ny >= board.H) continue;
        const j = flatIndex(nx, ny, board.W);
        if (!open[j] || seen[j] || board.tier[j] !== board.tier[p]!) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    cells.sort((a, b) => a - b);
    out.push({
      id: out.length, cells, rect: boundsOf(cells, board.W),
      tier: plate >= 0 ? composition.plates[plate]!.tier : 0,
      served: servedBy(board, cells),
    });
  }
  return out;
}

/** Does any of the district's cells stand beside pavement or a reserved flight corridor? */
function servedBy(board: Board, cells: readonly number[]): boolean {
  for (const i of cells) {
    const x = i % board.W, y = (i / board.W) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= board.W || ny >= board.H) continue;
      const j = flatIndex(nx, ny, board.W);
      if (board.paved[j] || board.reserved[j]) return true;
    }
  }
  return false;
}

function boundsOf(cells: readonly number[], W: number): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of cells) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// --- materials ---------------------------------------------------------------------------------

/** One dominant material with one or two accents, the way both references are paved: an accent goes
 *  on whole BRANCH streets and only until the accent share reaches the calibrated one, so the spine
 *  of a map reads as one road. */
function assignMaterials(
  board: Board, streets: readonly StreetRun[], rng: Rng, richness: number,
): { byStreet: (string | undefined)[]; accents: string[] } {
  const accentCount = 1 + (rng.float() < 0.3 + 0.4 * richness ? 1 : 0);
  const accents = shuffled(rng, ROAD_ACCENTS).slice(0, accentCount);
  const byStreet = new Array<string | undefined>(streets.length).fill(undefined);
  const owned = new Int32Array(streets.length);
  let paved = 0;
  for (let i = 0; i < board.owner.length; i++) {
    const street = board.owner[i]!;
    if (street < 0 || !board.paved[i]) continue;
    owned[street] = owned[street]! + 1;
    paved++;
  }
  const target = Math.round((1 - DOMINANT_SHARE) * paved);
  // The branches first, then anything that is not the primary walk: a map whose branch grid came out
  // short would otherwise be paved in one material from end to end, which neither reference is.
  const order = [
    ...shuffled(rng, streets.map((run, i) => ({ run, i })).filter(({ run }) => run.rank === 'branch').map(({ i }) => i)),
    ...shuffled(rng, streets.map((run, i) => ({ run, i })).filter(({ run }) => run.rank !== 'branch' && !run.primary).map(({ i }) => i)),
  ];
  let spent = 0;
  // A map whose streets are all too long for the accent budget would be paved in one material from
  // end to end; the smallest street takes the accent then, which is the reference's own habit read
  // at its floor rather than abandoned.
  const fallback = order
    .filter((i) => owned[i]! > 0 && owned[i]! <= 2 * target)
    .sort((a, b) => owned[a]! - owned[b]!)[0];
  for (const i of order) {
    // A street takes an accent whole or not at all, and only while the accent share stays under the
    // references' own: one material carries 87 to 95% of the pavement on both of them, so a street
    // that would tip the map past that is left in the dominant one.
    if (owned[i] === 0 || spent + owned[i]! > target) continue;
    byStreet[i] = accents[rng.int(accents.length)]!;
    spent += owned[i]!;
  }
  if (spent === 0 && fallback !== undefined) byStreet[fallback] = accents[0]!;
  return { byStreet, accents };
}

function readCells(board: Board, byStreet: (string | undefined)[]): RoadCell[] {
  const out: RoadCell[] = [];
  for (let y = 0; y < board.H; y++) {
    for (let x = 0; x < board.W; x++) {
      const i = flatIndex(x, y, board.W);
      if (!board.paved[i]) continue;
      const street = board.owner[i]!;
      out.push({
        x, y,
        rank: RANK_OF[board.rankAt[i]!] as RoadRank,
        material: (street >= 0 ? byStreet[street] : undefined) ?? ROAD_DOMINANT,
      });
    }
  }
  return out;
}

/** The ramp styles one map draws from: a seeded few out of the catalog, the way the terraced
 *  reference uses four rather than one. */
function pickStyles(rng: Rng): RampStyle[] {
  const items = getPlaceableByCategory(ItemCategory.Ramp).map((i) => ({ id: i.id, width: i.width }));
  return shuffled(rng, items).slice(0, Math.min(RAMP_STYLES, items.length));
}

// --- arithmetic ----------------------------------------------------------------------------------

function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i]!; a[i] = a[j]!; a[j] = t;
  }
  return a;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

/** Avalanche of two integers into one 32-bit value: neighbouring inputs give unrelated outputs. */
function mix(a: number, b: number): number {
  let h = (Math.imul(a ^ b, 0x27d4eb2d) + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A 0..1 hash of two integers: a tie between two nudges is broken positionally rather than off the
 *  rng stream, so a line lands in the same place whatever order the lines were considered in. */
function hash01(a: number, b: number): number {
  return mix(Math.imul(a, 0x2545f491), b) / 4294967296;
}
