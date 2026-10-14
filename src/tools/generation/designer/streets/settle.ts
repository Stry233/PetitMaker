/**
 * Settles a laid network: trims tails and stubs that arrive nowhere, joins near misses, and prunes
 * every piece the hub cannot walk to, keeping the stretches that link a flight.
 */
import { flatIndex, rectContains, cellKey } from '../../../../core/grid/rect';
import { NEIGHBORS4 } from '../../../../core/grid/directions';
import { type Board, erase, paint, restamp, skeletonLegal, stampOf } from './board';
import { flightIsUsed, freeCorridor, streetOfFlight } from './flights';
import { PIECE_MIN, type RampFlight, type StreetRun } from './model';
import { reachable, stranded } from './reach';

/**
 * A tail beyond the last junction longer than this is trimmed, unless it ends somewhere a walker
 * understands a street stopping — the coast, a flight, a crossing's channel, the plaza.
 *
 * It is one cell, not a street's own width: pavement running out into open grass is what the eye
 * reads as a dead end however few tip cells it holds, and at the quiet end of the richness axis
 * there is not yet a composed place at the end of every path for it to arrive at.
 */
const TAIL_MAX = 1;

/**
 * How much of one end a street may lose to the arrival rule.
 *
 * Past this the pavement is a street that runs out rather than a stub, and its length is what the
 * blocks along it are fronted by. A piece shorter than this goes entirely: a six-cell fragment
 * between two terrace steps that arrives at neither of them is not a street a walker can use, and
 * leaving it standing is what the arrival ledger reads as a dead end — the settling then drops what
 * is left of it, since a run under `PIECE_MIN` is not a piece.
 */
const TRIM_MAX = 8;
/** How far past its own end a street may look for what it arrives at, so the plan and a reading of
 *  the finished map agree about what a dead end is. */
export const ARRIVAL_REACH = 4;
/** How many planted cells within `ARRIVAL_REACH` of a street's end make the composed place it arrives at. */
export const ARRIVAL_DECOR = 4;
/** How wide a gap the near-miss join closes. A terrace seam costs a street one or two cells (the
 *  coating's window reads the step); past that the pavement was not nearly there. */
const JOIN_REACH = 3;
/**
 * How far ahead of a tip a street still counts as the one this street arrived at.
 *
 * It is the gap the join leaves behind, and the two numbers have to agree or the settling oscillates:
 * the join stops one cell short of the target (that cell is the target's own pavement), so a tip
 * whose arrival test only looked at the cell under it read the joined street as arriving nowhere,
 * the trimming took the join back, and the next pass joined it again — for every pass the bound
 * allowed, leaving the board in whatever state the last one happened to make.
 */
const JOIN_LEFT = 1;

// --- tails ---------------------------------------------------------------------------------------

/**
 * No street ends at nothing, read as a walker reads it: `trimTails` cuts back to the last crossing,
 * which can still leave a street stopping in open grass. Each end is walked inward until it arrives
 * (coast or map edge, the plaza, a flight's corridor or a crossing's channel); what cannot arrive is
 * erased, and a run cut below a street's length goes entirely. Read on the plan, blind to what stage
 * C will compose, so it errs toward a shorter street rather than a dead end.
 */
function trimToArrivals(board: Board, streets: StreetRun[]): void {
  for (let index = 0; index < streets.length; index++) {
    const run = streets[index]!;
    for (const end of [1, -1] as const) {
      // The cut is bounded, and the bound is a total over the whole settling (`StreetRun.eroded`).
      // A street that cannot arrive within `TRIM_MAX` cells of its tip is not a stub running into
      // open grass, it is a long street running out at a plate edge.
      const eroded = run.eroded ?? (run.eroded = [0, 0]);
      const side = end === 1 ? 1 : 0;
      for (let guard = eroded[side]!; guard < TRIM_MAX; guard++) {
        const tip = end === 1 ? run.to : run.from;
        if (run.to < run.from) break;
        if (arrivesFrom(board, streets, { run, index, tip, end })) break;
        // A street may end at nothing and still be somebody's only frontage, and the two wants
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
 * except the cells being erased. The rest of the run goes on running beside the same block, so
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
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= board.W || ny >= board.H) continue;
        if (rectContains(s, nx, ny)) continue;
        const j = flatIndex(nx, ny, board.W);
        if (board.reserved[j] || board.paved[j]) { served = true; break; }
      }
      if (!served) return false;
    }
  }
  return true;
}

/** One end of a run: the run, its index among the streets, the tip cell along its axis and the
 *  direction it faces. */
interface RunTip { run: StreetRun; index: number; tip: number; end: 1 | -1 }

/**
 * Whether the run's pavement at `tip`, looking outward along `end`, reaches something a walk arrives
 * at within `ARRIVAL_REACH`: the coast, the map's edge, the plaza, a flight's corridor, a crossing's
 * channel — or another street, which is the junction grammar's own answer.
 *
 * A street that stops against another street has arrived: it is a T-junction, and the network is
 * made of T's. Without this reading a staggered leg would be eroded
 * off the very street it steps across at, and the two halves of one line would part company.
 *
 * The street test starts at the tip and not ahead of it: a leg laid up to a crossing ends inside the
 * crossing street's band, and the cells it stands on there belong to that street rather than to it.
 */
function arrivesFrom(board: Board, runs: readonly StreetRun[], at: RunTip): boolean {
  const { run, tip, end } = at;
  if (meetsStreet(board, runs, at, { first: 0, reach: JOIN_LEFT }) > 0) return true;
  const s = stampOf(
    run.axis === 'y' ? run.line : tip, run.axis === 'y' ? tip : run.line, run.width,
  );
  const across = run.axis === 'y' ? s.x : s.y;
  const along = run.axis === 'y' ? s.y + (end === 1 ? s.h - 1 : 0) : s.x + (end === 1 ? s.w - 1 : 0);
  for (let k = 1; k <= ARRIVAL_REACH; k++) {
    for (let a = -1; a <= run.width; a++) {
      const at = along + end * k;
      const x = run.axis === 'y' ? across + a : at;
      const y = run.axis === 'y' ? at : across + a;
      if (x < 0 || y < 0 || x >= board.W || y >= board.H) return true;
      const i = flatIndex(x, y, board.W);
      if (!board.land[i]) return true;
      if (board.stopAt[i] || rectContains(board.hubArea, x, y)) return true;
    }
  }
  return false;
}

/**
 * How far ahead of the run's tip, along `end`, the street it was heading for stands: 0 where none
 * does within `reach`.
 *
 * "Heading for" is the junction test and not merely a proximity one. The pavement has to lie
 * straight ahead of the tip's own stamp — a street the tip merely passes beside is not one it meets
 * — and it has to belong either to a street of the other axis (the T) or to another piece of this
 * very line (a street the ground cut in two). Every cell between has to be ground this street could
 * legally have been laid on, so the answer is a gap that can actually be closed.
 */
function meetsStreet(
  board: Board, runs: readonly StreetRun[], { run, index, tip, end }: RunTip,
  { first, reach, live }: { first: number; reach: number; live?: Uint8Array },
): number {
  // The look starts one step past the tip even where the answer may not be nearer than `first`: the
  // cells between the tip and the street it meets are what a join paves, so every one of them has to
  // pass the gate below, the first one beyond the tip included.
  for (let k = Math.min(first, 1); k <= reach; k++) {
    const t = tip + end * k;
    const x = run.axis === 'y' ? run.line : t;
    const y = run.axis === 'y' ? t : run.line;
    const s = stampOf(x, y, run.width);
    if (s.x < 0 || s.y < 0 || s.x + s.w > board.W || s.y + s.h > board.H) return 0;
    if (k >= first) for (let cy = s.y; cy < s.y + s.h; cy++) {
      for (let cx = s.x; cx < s.x + s.w; cx++) {
        const i = flatIndex(cx, cy, board.W);
        const owner = board.owner[i]!;
        if (owner < 0 || owner === index) continue;
        const other = runs[owner];
        if (!other) continue;
        if (other.axis === run.axis && other.line !== run.line) continue;
        // For the join, the target has to be pavement the plaza can already walk to. Gluing two
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
 * The near-miss join: a street stopping a cell or two short of the one it aimed at, where a terrace
 * step left a gap in the pavable mask, so the settling would prune the stub or leave it as tip cells.
 * Rather than extend every stub toward anything near, `meetsStreet` answers only for a street
 * straight ahead that this one could have run into, and the extension is exactly the gap: a T.
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
      const gap = meetsStreet(board, streets, { run, index, tip, end }, { first: 2, reach: JOIN_REACH, live: reach });
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
 * Trims a street's tail beyond its last junction (no dead ends).
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
      for (let x = r.x - 1; x <= r.x + r.w; x++) out.add(cellKey(x, y));
    }
  }
  return out;
}

/** Does the run's tip end somewhere a street may legitimately stop: at the coast, at the map edge,
 *  against a flight, or at the plaza — the hub is a destination like any other, and a trunk laid
 *  along its ring is the shortest street on the map that is certainly going somewhere. Without this
 *  a hub whose four trunks are cut into pieces that never meet reads as four tails, they are all
 *  trimmed, and then every street on the planet is pruned for being unreachable from a plaza no
 *  pavement touches. */
function tipStops(
  board: Board, run: StreetRun, tip: number, end: 1 | -1, flightEnds: ReadonlySet<string>,
): boolean {
  const t = tip + end;
  const x = run.axis === 'y' ? run.line : t;
  const y = run.axis === 'y' ? t : run.line;
  if (x < 0 || y < 0 || x >= board.W || y >= board.H) return true;
  if (flightEnds.has(cellKey(x, y))) return true;
  // A flight's corridor and a crossing's channel are both places a walker understands a street
  // stopping at: the way on is the ramp or the deck standing in them.
  if (board.stopAt[flatIndex(x, y, board.W)]) return true;
  if (touchesHub(board, run, tip)) return true;
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
function touchesHub(board: Board, run: StreetRun, t: number): boolean {
  const x = run.axis === 'y' ? run.line : t;
  const y = run.axis === 'y' ? t : run.line;
  const s = stampOf(x, y, run.width);
  const p = board.hubArea;
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
        if (flightEnds.has(cellKey(cx, cy)) || board.stopAt[i]) return t;
        if (board.paved[i] && board.owner[i] !== index) return t;
      }
    }
  }
  return end === 1 ? run.from : run.to;
}

// --- settling --------------------------------------------------------------------------------------

/**
 * The plan the board holds after the flights and trimming took pavement back. Pruning rebuilds
 * rather than erases, since erasing leaves 1-wide slivers the rank hierarchy forbids: each pass keeps
 * the stretches whose whole stamp is pavable, unreserved and reachable from the plaza, drops what is
 * shorter than a street, and restamps, so every paved cell sits in a full `w x w` stamp.
 *
 * A fixpoint, since a dropped run can strand pieces and a retired flight returns its corridor; four
 * passes is well past what a map needs. Every reason to retire a flight is tested inside the loop,
 * or one retired after the last pass would leave its pavement unreachable.
 */
export function settle(
  board: Board, streets: StreetRun[], flights: readonly RampFlight[],
): { streets: StreetRun[]; flights: RampFlight[] } {
  let runs: StreetRun[] = streets;
  let live: RampFlight[] = [...flights];
  // Why the loop ends. Two of the three things a pass does only ever remove — the trims take
  // pavement off an end, the pruning drops a run or a flight — and both are bounded below by an
  // empty map. The third, the near-miss join, adds pavement; it terminates on its own count instead,
  // since an end is offered a join exactly once (`StreetRun.joinedEnd`), so there are at most two
  // joins per run over the whole settling however many passes it takes. A pass that joined is not a
  // settled pass, and a pass that left pavement the plaza cannot walk to is not either: stability is
  // Both, which is what the `stranded` term below is for. The bound is a safety net scaled to what
  // there is to remove and to join, not the expected count: maps settle in one or two passes.
  const passes = 2 * (streets.length + flights.length) + 4;
  for (let pass = 0; pass < passes; pass++) {
    // The join comes before the trims. A stub two cells short of the street it aimed at is a dead end
    // to both of them, so closing it first is what stops the trimming from cutting back a street that
    // was about to arrive.
    const joined = joinNearMisses(board, runs, reachable(board, live));
    trimTails(board, runs, live);
    trimToArrivals(board, runs);
    const trimmed = runs.filter((r, index) => r.to - r.from >= PIECE_MIN - 1 || linksToFlight(board, runs, r, index));
    restamp(board, trimmed);
    const pruned = prune(board, trimmed, live);
    restamp(board, pruned);
    const kept = live.filter((f) => flightIsUsed(board, f) && streetOfFlight(board, pruned, f) >= 0);
    for (const f of live) if (!kept.includes(f)) freeCorridor(board, f);
    // A pass is settled when it changed nothing and left nothing stranded.
    //
    // The join runs before the trims and mutates the run list in place, so the list comparison alone
    // sees its result as though it had always been there and the loop would break on the very pass
    // that changed the board. And `prune` judges reachability on the board as it stands before its
    // own removals, so a piece kept because a neighbour reached it can still be standing after that
    // neighbour was taken back in the same pass. Reading the board it actually leaves is what closes
    // both, so no bend's link is left standing with both its legs gone.
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

/** The stretches of each run that are still whole streets: stamp legal, and pavement the plaza
 *  reaches. A run whose middle went unreachable comes back as two. */
export function prune(board: Board, runs: readonly StreetRun[], flights: readonly RampFlight[]): StreetRun[] {
  const reach = reachable(board, flights);
  const out: StreetRun[] = [];
  runs.forEach((run, index) => {
    let start = -1;
    for (let t = run.from; t <= run.to + 1; t++) {
      if (t <= run.to && stampReaches(board, run, t, reach)) { if (start < 0) start = t; continue; }
      const piece = { ...run, from: start, to: t - 1 };
      if (start >= 0 && (t - start >= PIECE_MIN || linksToFlight(board, runs, piece, index))) out.push(piece);
      start = -1;
    }
  });
  return out;
}

/**
 * Whether a stretch shorter than a street is the link between a flight and the network: one end
 * against a flight's corridor or the plaza, and the stretch joined to the network beyond it: its other
 * end arriving (`arrivesFrom`) or another street crossing it.
 *
 * A flight's lowest ramp runs on below the step, so its corridor takes the last cells of the street
 * that climbs to it. Between the plaza and a step a few cells away that leaves a stretch under
 * `PIECE_MIN`, which read as a stub and went; the flight it carried then had no street at one end,
 * was retired, and every street beyond it was pruned for want of a way to the plaza. Whether the
 * stretch came out at five cells or six was a matter of where the plaza and the step happened to
 * stand, which made a whole network appear and vanish with a one-cell move of the plaza.
 */
function linksToFlight(board: Board, runs: readonly StreetRun[], piece: StreetRun, index: number): boolean {
  if (piece.to < piece.from) return false;
  const atStop = (end: 1 | -1): boolean => {
    const tip = end === 1 ? piece.to : piece.from;
    const s = stampOf(piece.axis === 'y' ? piece.line : tip, piece.axis === 'y' ? tip : piece.line, piece.width);
    // Two cells out: the corridor's dual-grid margin (`reserveMargin`) can stand between the street and it.
    for (let k = 0; k < 2; k++) {
      const along = (piece.axis === 'y' ? s.y + (end === 1 ? s.h : -1) : s.x + (end === 1 ? s.w : -1)) + end * k;
      for (let a = 0; a < piece.width; a++) {
        const x = piece.axis === 'y' ? s.x + a : along;
        const y = piece.axis === 'y' ? along : s.y + a;
        if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
        if (board.stopAt[flatIndex(x, y, board.W)] || rectContains(board.hubArea, x, y)) return true;
      }
    }
    return false;
  };
  const crossed = crossesStreet(board, runs, piece, index);
  const links = (end: 1 | -1): boolean => atStop(end)
    && arrivesFrom(board, runs, { run: piece, index, tip: end === 1 ? piece.to : piece.from, end })
    && (crossed || arrivesFrom(board, runs, { run: piece, index, tip: end === 1 ? piece.from : piece.to, end: end === 1 ? -1 : 1 }));
  return links(1) || links(-1);
}

/** Whether another street's pavement crosses the run's pavement or meets it from the side: a
 *  junction along the stretch, where `arrivesFrom` reads only its two ends. */
function crossesStreet(board: Board, runs: readonly StreetRun[], run: StreetRun, index: number): boolean {
  for (let t = run.from; t <= run.to; t++) {
    const s = stampOf(run.axis === 'y' ? run.line : t, run.axis === 'y' ? t : run.line, run.width);
    const [x0, x1] = run.axis === 'y' ? [s.x - 1, s.x + s.w] : [s.x, s.x + s.w - 1];
    const [y0, y1] = run.axis === 'y' ? [s.y, s.y + s.h - 1] : [s.y - 1, s.y + s.h];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= board.W || y >= board.H) continue;
        const owner = board.owner[flatIndex(x, y, board.W)]!;
        if (owner < 0 || owner === index) continue;
        const other = runs[owner];
        if (other && other.axis !== run.axis) return true;
      }
    }
  }
  return false;
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
