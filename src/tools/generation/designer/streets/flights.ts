/**
 * Plans the ramp flights that carry streets over tier steps: inline flights, entry flights into
 * shut blocks, opportunity and end flights, and the hub's own descents.
 */
import { flatIndex, rectContains, type Rect } from '../../../../core/grid/rect';
import { NEIGHBORS4 } from '../../../../core/grid/directions';
import { type Rng, hash01, shuffled } from '../../../../core/base/rng';
import { ROTATIONS } from '../../../../core/model/types';
import { rampOrientation } from '../../../../core/domain/terrain/ramp-span';
import type { CompositionPlan } from '../composition/composition';
import { rampStyles } from '../ramps';
import { cutDistricts } from './blocks';
import { type Board, acrossOf, acrossSpan, alongRect, firstPaved, lastPaved, stampOf, tierAt } from './board';
import { type District, ENTRY_MIN_CELLS, type FlightCandidate, type RampFlight, type RampSpec, type RampStyle, type StreetRun } from './model';
import { componentsOf, hubComponents } from './reach';

/** Ramp styles one map draws from: a few, so one style dominates. */
const RAMP_STYLES = 3;
/**
 * The shortest pair of stretches an opportunity flight is built between.
 *
 * The spanning growth buys the ramps that make the network one walk; this is the second half of the
 * rule — where a street runs into a step and a ramp is legal and would connect, one stands, whether or
 * not the walk could already get there another way. A step between
 * two stubs is furniture; a step between two real streets is a way up, so the two stretches have to
 * be streets before the ramp is worth its budget.
 */
const OPPORTUNITY_MIN_RUN = 10;

/**
 * The flights, grown out from the plaza as a spanning tree over the pavement.
 *
 * Every piece of pavement is a component; a flight is an edge between the two components a step
 * separates. Only flights that reach a component the plaza cannot yet walk to are built, so a map
 * carries exactly as many ramps as it needs to be one network and not one more. Growing from the plaza
 * rather than merging greedily
 * anywhere is what spends the budget on reaching the hub: a spanning forest would buy staircases
 * between two terraces nobody can get to in the first place. Components the budget cannot reach are
 * erased by `settle` rather than left standing unreachable.
 */
export function planFlights(
  board: Board, streets: StreetRun[], styles: readonly RampStyle[], salt: number, budget: number,
): RampFlight[] {
  const groups = componentsOf(board);
  const joined = hubComponents(board, groups.comp);
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
      // The walk is continuous or it is not a walk. A step in the middle of the movement line takes
      // its flight whether or not the network could already get to the far side another way: the
      // climb is the story, and a walk that has to leave its own line and come back is not one. A
      // street stepping down off the plaza's plate takes its flight too: the plaza is where every
      // walk starts, and a street that leaves it without a way down leaves the ground below reached
      // only by a detour the settling may take back.
      if (inA === inB && !streets[candidate.street]?.primary && !leavesHub(board, candidate)) continue;
      // Two components neither of which the plaza reaches are still two components: a primary flight
      // joins them, and calling either one reachable would let a later flight that would have joined
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
 * The entry flights: a way up onto a block whose street runs along its foot.
 *
 * A street cannot be laid on a terrace's own edge — the flat trait forbids the cell before a step —
 * so a street following a terrace foot leaves the ground above it two cells away and unreachable.
 * That is a terraced planet's own arrangement, and its answer is a ramp: the flight here climbs
 * off the street at right angles, cutting it where it crosses. The street stays one network, since
 * the ramps conduct between the two pieces the cut leaves.
 *
 * Only blocks big enough to be composed on are worth a flight, and only one flight is spent per
 * block: this is access, not a staircase every few cells.
 */
export function planEntries(
  board: Board, streets: readonly StreetRun[], composition: CompositionPlan,
  budget: number, ramps: { styles: readonly RampStyle[]; salt: number },
): RampFlight[] {
  const { styles, salt } = ramps;
  const out: RampFlight[] = [];
  let spent = 0;
  // A block is only entered on the level. `served` asks whether pavement runs along a block, which a
  // street at the foot of a terrace does without offering any way up onto it — and that arrangement
  // is exactly the arrangement a ramp answers. So the flights are looked
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
export function spentOn(flights: readonly RampFlight[]): number {
  return flights.reduce((n, f) => n + f.ramps.length, 0);
}

/**
 * A flight at the end of a street that stops at a terrace step, where nothing joins and no spanning
 * or opportunity flight is built. The ramp is the way on and the arrival, and buys the terrace above
 * as reachable ground. Anchored like an entry flight, with pavement at its foot only.
 */
export function planEndFlights(
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
      // Which cell the first ramp reads its cliff from: the high ground's own edge cell, which is the
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
 * Holds every step that splits one line into two pieces at different tiers as a place a street may
 * stop, until the opportunity flights are planned, and returns the cells it marked.
 *
 * The spanning pass declines such a flight where the network already reaches both pieces, and the
 * settling that follows trims the upper piece back to its last crossing, since nothing carries it on.
 * The opportunity pass that would build the flight then finds no pair of pieces left, and the stub
 * the trim leaves past the crossing ends at nothing on both sides. Whether a line meets such a step
 * depends on where the plaza's trunks and the plate edges fall, so without the hold a one-cell move
 * of the plaza decides whether the line climbs or strands its stubs.
 */
export function holdSteps(board: Board, streets: readonly StreetRun[]): number[] {
  const out: number[] = [];
  for (const c of findCandidates(board, streets)) {
    const gap = c.down === 1 ? c.step : c.step - 1;
    for (let a = c.across; a < c.across + c.span; a++) {
      const x = c.axis === 'y' ? a : gap;
      const y = c.axis === 'y' ? gap : a;
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      const i = flatIndex(x, y, board.W);
      if (board.reserved[i] || board.stopAt[i]) continue;
      board.stopAt[i] = 1;
      out.push(i);
    }
  }
  return out;
}

/**
 * The opportunity flights: every remaining step between two real streets where a ramp is legal,
 * while the budget lasts, since a walker meeting a cliff between two roads does not care about the
 * way round. Bounded by the same ramp budget, both stretches being long enough to be streets, and
 * the runway test refusing any corridor across somebody else's pavement.
 */
export function planOpportunities(
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

/** Whether a walker can step onto the block from a street without climbing: pavement at the block's
 *  own tier beside it, or a flight corridor already reaching it. */
function enteredOnTheLevel(board: Board, block: District): boolean {
  for (const i of block.cells) {
    const x = i % board.W, y = (i / board.W) | 0;
    const tier = board.tier[i]!;
    for (const [dx, dy] of NEIGHBORS4) {
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
 *  to stand in the middle of the frontage it opens rather than at a corner of it. */
function entryCandidates(board: Board, block: District): FlightCandidate[] {
  const out: FlightCandidate[] = [];
  const seen = new Set<string>();
  for (const i of block.cells) {
    const x = i % board.W, y = (i / board.W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
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
      // Which cell the first ramp reads its cliff from: the high plate's own edge cell, walking down
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
      if (x < 0 || y < 0 || x >= board.W || y >= board.H || rectContains(r, x, y)) continue;
      const i = flatIndex(x, y, board.W);
      if (board.paved[i] && board.owner[i]! >= 0) return board.owner[i]!;
    }
  }
  return -1;
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
 * The two pieces are read by their pavement, not by their skeletons. A skeleton stands `w` cells
 * clear of a step (its whole stamp has to be pavable and the flat trait forbids the cell before the
 * step), but the stamp reaches one cell past the skeleton either way, so whatever the width, the two
 * pieces of one line leave exactly one unpaved cell between them — the cell the ramp reads its cliff
 * from. That cell belongs to the high plate where the street descends along the axis and to the low
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
      // The two pieces may be laid at different widths (a piece narrowed against a plate edge), and
      // the flight carries only the rows both of them pave: a ramp row beyond the narrower piece
      // would have its top or its foot on the plate beside the street, and the trait refuses it.
      const [a0, a1] = acrossSpan(run), [b0, b1] = acrossSpan(other);
      const across = Math.max(a0, b0), span = Math.min(a1, b1) - across + 1;
      if (span <= 0) continue;
      out.push({
        street: index, axis: run.axis, line: run.line, entry: false,
        across, span, down,
        step: down === 1 ? gap : gap + 1,
        highTier: Math.max(hereTier, thereTier), lowTier: Math.min(hereTier, thereTier),
        weight: Math.min(run.to - run.from, other.to - other.from),
      });
    }
  }
  return out;
}

/** Whether a flight's high side is the plaza's own plate: a street stepping down off the hub. */
function leavesHub(board: Board, c: FlightCandidate): boolean {
  const x = c.axis === 'y' ? c.line : c.step;
  const y = c.axis === 'y' ? c.step : c.line;
  return board.hubPlate[flatIndex(x, y, board.W)] === 1;
}

/**
 * The ramps the streets leaving the plaza's plate need to step down off it: the tiers of every step
 * whose high side is that plate. They are owed on top of the scenery budget, since the plaza's own
 * ground and not the richness raised that plate; a plate at the lowest ground owes none.
 */
export function hubDescent(board: Board, streets: readonly StreetRun[]): number {
  let owed = 0;
  for (const c of findCandidates(board, streets)) if (!c.entry && leavesHub(board, c)) owed += c.highTier - c.lowTier;
  return owed;
}

/** Each tier uses the selected catalog ramp's run, including its high-side half-cell overlap. */
function buildFlight(
  board: Board, streets: readonly StreetRun[], c: FlightCandidate, styles: readonly RampStyle[], salt: number,
): RampFlight | null {
  const tiers = c.highTier - c.lowTier;
  const fits = styles.filter((s) => s.width <= c.span);
  const item = fits[Math.floor(hash01(salt ^ c.street, c.step) * fits.length)];
  if (!item) return null;
  const { width, run } = item;
  // The corridor is one cell wider than the ramp where the street itself is not: a whole-anchored
  // footprint is read by the trait one cell past its own width (terrain renders half a cell up-left),
  // and every cell the trait reads has to be terrace the sculptor may carve, not somebody's pavement.
  const across = c.across;
  const spread = Math.max(c.span, width + 1);

  const ramps: RampSpec[] = [];
  const landings: { rect: Rect; tier: number }[] = [];
  for (let k = 0; k < tiers; k++) {
    // The high cell of this step, walking down the flight.
    const high = c.step + c.down * run * k;
    const low0 = high + c.down;
    const lowLast = high + c.down * run;
    const highTier = c.highTier - k;
    // The trait reads the high cell plus the whole run below it, so the ground it needs is one cell
    // longer than the footprint.
    const lo = Math.min(high, lowLast), hi = Math.max(high, lowLast);
    if (!clearRunway(board, streets, c, { across, spread }, { lo, hi })) return null;
    ramps.push(rampSpec({ axis: c.axis, down: c.down, across, high, width, run }, item.id, highTier));
    // The last flight of steps lands on the low plate's own surface; every one before it lands on a
    // terrace the sculptor carves.
    if (k < tiers - 1) {
      landings.push({
        rect: alongRect(c.axis, across, spread, Math.min(low0, lowLast), Math.max(low0, lowLast)),
        tier: highTier - 1,
      });
    }
  }
  if (!landsOnTheLowPlate(board, c, { across, spread }, tiers, run)) return null;
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
  board: Board, c: FlightCandidate, band: { across: number; spread: number }, tiers: number, run: number,
): boolean {
  const { across, spread } = band;
  const last = c.step + c.down * run * (tiers - 1);
  const rect = alongRect(
    c.axis, across, spread,
    Math.min(last + c.down, last + c.down * run), Math.max(last + c.down, last + c.down * run),
  );
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) return false;
      if (board.tier[flatIndex(x, y, board.W)] !== c.lowTier) return false;
    }
  }
  return true;
}

/** One ramp, positioned and rotated the way the heightDrop trait resolves the cliff it stands at. */
function rampSpec(
  { axis, down, across, high, width, run }: {
    /** The axis the flight runs along, and which way along it the ground falls. */
    axis: 'x' | 'y'; down: 1 | -1;
    /** The flight's first cell across the axis and its high cell along it. */
    across: number; high: number;
    width: number; run: number;
  },
  catalogId: string, elevation: number,
): RampSpec {
  // Descending as the along-coordinate grows puts the high end at the span's start.
  const rotation = ROTATIONS.find((r) => {
    const o = rampOrientation(r);
    return o.spanAxis === axis && o.highAtStart === (down === 1);
  })!;
  const startAlong = rampOrientation(rotation).highAtStart ? high : high - run;
  const position = axis === 'y' ? { x: across, y: startAlong } : { x: startAlong, y: across };
  const footprint = axis === 'y'
    ? { x: across, y: startAlong, w: width, h: run }
    : { x: startAlong, y: across, w: run, h: width };
  return { catalogId, position, rotation, elevation, footprint };
}

/**
 * Whether the ground the flight needs is there to take.
 *
 * The tiers under it are the sculptor's to carve, so what is read here is the planet, the plaza and
 * what other flights already claimed — plus one thing the geometry cannot fix afterwards: pavement
 * belonging to a street on another line. A flight crossing one of those would put a ramp on a road,
 * and erasing the road instead would leave a hole in the middle of a street. Such a candidate is
 * refused and the district it would have served waits for another street's flight.
 */
function clearRunway(
  board: Board, streets: readonly StreetRun[], c: FlightCandidate,
  band: { across: number; spread: number }, span: { lo: number; hi: number },
): boolean {
  const { across, spread } = band;
  const { lo, hi } = span;
  const rect = alongRect(c.axis, across, spread, lo, hi);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) return false;
      const i = flatIndex(x, y, board.W);
      if (!board.land[i] || board.reserved[i] || rectContains(board.hubArea, x, y)) return false;
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
 * The clearing is by cell and not by stamp: a stamp is a `w x w` square, so erasing the skeleton
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
 * The corridor's dual-grid margin: the row above it and the column left of it.
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
      if (rectContains(landing.rect, x, y)) return landing.tier;
    }
    return board.tier[flatIndex(x, y, board.W)]!;
  };
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 1 || y < 1 || x >= board.W || y >= board.H) continue;
      const level = tierAtCell(x, y);
      for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1]] as const) {
        const mx = x + dx, my = y + dy;
        if (rectContains(r, mx, my)) continue;
        const m = flatIndex(mx, my, board.W);
        if (board.tier[m] === level) continue;
        board.paved[m] = 0; board.owner[m] = -1; board.rankAt[m] = 0;
        board.reserved[m] = 1;
      }
    }
  }
}

export function freeCorridor(board: Board, flight: RampFlight): void {
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
export function streetOfFlight(board: Board, runs: readonly StreetRun[], flight: RampFlight): number {
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
 *  and pavement anywhere against an entry, whose corridor runs across the street it climbs off (so
 *  what is left of that street stands beside the corridor, not beyond its ends). */
export function flightIsUsed(board: Board, flight: RampFlight): boolean {
  const r = flight.corridor;
  let low = false, high = false;
  // An inline flight's street may stop a cell short of the corridor, where the corridor's dual-grid
  // margin (`reserveMargin`) holds the cell beside it; the ramps' dilated footprint still joins the
  // two (`reachable`), so pavement two cells out along the climb still arrives.
  const [ay, ax] = flight.entry ? [1, 1] : flight.axis === 'y' ? [2, 1] : [1, 2];
  for (let y = r.y - ay; y <= r.y + r.h + ay - 1; y++) {
    for (let x = r.x - ax; x <= r.x + r.w + ax - 1; x++) {
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
      if (rectContains(r, x, y) || !board.paved[flatIndex(x, y, board.W)]) continue;
      if (flight.entry) return true;
      const along = flight.axis === 'y' ? y : x;
      if (along < (flight.axis === 'y' ? r.y : r.x)) low = true;
      else if (along >= (flight.axis === 'y' ? r.y + r.h : r.x + r.w)) high = true;
    }
  }
  return low && high;
}

/** The ramp styles one map draws from: a seeded few out of the catalog, so a terraced planet's
 *  flights vary rather than repeat one style. */
export function pickStyles(rng: Rng): RampStyle[] {
  const items = rampStyles().map((i) => ({ id: i.id, width: i.width, run: i.height }));
  return shuffled(rng, items).slice(0, Math.min(RAMP_STYLES, items.length));
}
