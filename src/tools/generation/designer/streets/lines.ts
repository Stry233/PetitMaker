/**
 * Lays the street skeleton: the movement line as the primary trunk, then trunk and branch lines at
 * a seeded spacing, staggered and jogged off the grid, on cells their full stamp can pave.
 */
import { flatIndex } from '../../../../core/grid/rect';
import { mix, hash01 } from '../../../../core/base/rng';
import { lerpClamped } from '../../../../core/base/math';
import type { CompositionPlan } from '../composition/composition';
import { LINE_W, type MovementLine } from '../composition/movement-line';
import { BRANCH_W, TRUNK_W } from '../types';
import { cutDistricts } from './blocks';
import { type Board, paint, skeletonLegal, stampOf } from './board';
import { type District, ENTRY_MIN_CELLS, type LineSpec, PIECE_MIN, type StreetRun } from './model';

// --- tunables ----------------------------------------------------------------------------------

/** Branch-street centre spacing. Flat maps use a denser grid; terraces provide extra partitions. */
const SPACING = { low: 20, high: 24 } as const;
/** How far a single gap may stand from the nominal spacing, as a share of it. A ruled grid is the
 *  thing the eye reads first and likes least, and a planet has a wide block-size spread at one
 *  pavement share (a garden town's median block is half its mean), so the gaps vary widely. */
const SPACING_SPREAD = 0.45;
/** How much each gap grows over the one inside it. The blocks by the plaza are the town's and the
 *  ones at the rim are its fields, which is the game's own centre-to-rim gradient read as block size, and it is what
 *  gives a map its spread of block areas at one pavement share. */
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
 * The quiet end of the axis is the flat garden town: a thin grid on a plain, with no terraces
 * cutting the planet and nothing else partitioning it. Every street there carries a block's whole
 * frontage, so a stagger costs one — at richness 0, one seed comes back with seven of its thirty street
 * ends stopping in open grass, ground the erosion cannot take back because each stub is the only pavement
 * its block has. A street grid that reads as a lattice is a full-richness failure only.
 */
const ANTI_GRID_FROM = 0.15;
/** Weight on hugging a plate edge when a nudge is chosen: a street laid along the natural block edge
 *  is where a street belongs, and the alternative, a street a cell or two inside the edge, leaves a
 *  sliver of terrace nobody can compose on. */
const HUG_BONUS = 0.2;
/** The shortest piece of a trunk that is still a spine. Below it the piece is laid as a branch: the
 *  rank hierarchy is about what a street carries, and a fragment carries a block's frontage. */
const TRUNK_MIN_RUN = 20;
/** How far inside a block's own foot the street that serves it stands. Two cells: where the foot is a
 *  terrace step the rim cell before it can never be paved (the coating's window reads the step), so
 *  the stamp starts on the first cell that can be. */
const BLOCK_LINE_INSET = 2;
/** How many legs of the walk are laid at the full primary width before it steps down to a trunk. */
const LINE_WIDE_LEGS = 1;
/** One stretch of a line the ground allows, before it is known whether the network reaches it. */
interface Piece { spec: LineSpec; from: number; to: number }
/** What every line of one layout reads: its seed, the richness slider, and the crown terrace it leaves whole. */
interface LineRun { seed: number; richness: number; crown: Uint8Array }

/**
 * The whole street layer, laid hierarchy first. The four trunks are the plaza's cross: lines tangent
 * to its four faces spanning the planet, so the hub ring and the four outward spines the game's
 * guidance asks for are the same four lines, laid in a turning order so each crosses the one before.
 *
 * A line is cut into the maximal pieces its ground allows and every piece is laid; connectivity is
 * settled afterwards by the flights and `dropStranded`, since a piece on the plate above the plaza
 * touches nothing until its flight exists.
 */
export function layStreets(
  board: Board, composition: CompositionPlan, richness: number, seed: number, line?: MovementLine,
): StreetRun[] {
  const out: StreetRun[] = [];
  const run: LineRun = { seed, richness, crown: crownMask(board, composition) };
  for (const spec of lineSpecs(board, composition, richness, seed, line)) {
    layLine(board, spec, run, out);
  }
  // The blocks the grid missed, once it is known which those are.
  for (const spec of unservedBlockLines(board, composition)) {
    layLine(board, spec, run, out);
  }
  return out;
}

/**
 * The planet's top terrace, which the anti-grid leaves whole.
 *
 * The highest plate is where the planet's one set piece stands (`terrain/landmark.ts`) and where the
 * water story's own upper bodies are cut, and both of those need a panel of clear ground at one
 * tier: a staggered street cuts the terrace into pieces none of which is wide enough, and the figure
 * pass comes back with nothing while a pond trimmed to what is left comes back a rectangle the water
 * ledger reads as a tofu lake.
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
function layLine(board: Board, spec: LineSpec, run: LineRun, out: StreetRun[]): void {
  // The primary walk is laid as wide as the ground takes it, stretch by stretch. Its width is the
  // widest pavement on the map, which is what makes it legible as the map's own line; where the
  // terrace it crosses is too narrow for that stamp it steps down to a trunk and then to a branch,
  // exactly as a trunk does against the plaza's ring. Asking the whole leg at one width left the
  // narrow stretches bare — on a terraced planet the walk came back less than half paved, which is a
  // walk with holes in it rather than a walk that narrows.
  //
  // And it never staggers: the walk is the one line a visitor is meant to follow from the plaza to
  // the summit, and a walk that steps sideways at every street it meets is not one line any more.
  if (spec.primary) { layPrimary(board, spec, out); return; }
  if (run.richness < ANTI_GRID_FROM) { layStraight(board, spec, out); return; }
  for (const leg of staggered(board, spec, run, out)) layStraight(board, leg, out);
}

/** One straight stretch of a line: cut into the pieces its ground allows, laid at the width the
 *  ground takes. */
function layStraight(board: Board, spec: LineSpec, out: StreetRun[]): void {
  {
    let pieces = piecesOf(board, spec);
    // A trunk that cannot stand at three stands at two. The four trunks are the plaza's own ring,
    // and the ring is as wide as the composition left it: where the hub's plate keeps only a
    // two-cell verge, a 3-wide stamp fits nowhere along it and the map comes back with no street
    // against the plaza at all, which prunes every other street on the planet for being
    // unreachable. A 2-wide apron is still a street, and the
    // hierarchy is a preference, not a hard rule; what is hard is that no road is 1 wide.
    if (spec.rank === 'trunk' && pieces.length === 0) {
      pieces = piecesOf(board, { ...spec, width: BRANCH_W });
    }
    for (const piece of pieces) {
      // A short piece of a trunk is not a trunk. The plaza's cross is cut into as many pieces as its
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
 * One line broken into the legs a staggered street walks. Every stretch over a street of the other
 * axis is a crossing it could stagger at: it staggers once it has run `STAGGER_EVERY` cells since the
 * last step and must past `LONG_RUN_SHARE` of the planet. Consecutive legs overlap the crossing
 * street, so the pair reads as two T-junctions rather than one four-way.
 *
 * It runs on straight unless the far side can carry a street (`JOG_MIN_RUN`), the new coordinate does
 * not walk into a parallel street, and the crossing street is paved across the step (`bridges`). The
 * jog's size and side are positional (`hash01`), so an earlier line's ground never moves them.
 */
function staggered(board: Board, spec: LineSpec, run: LineRun, laid: readonly StreetRun[]): LineSpec[] {
  const { seed, richness, crown } = run;
  const along = spec.axis === 'y' ? board.H : board.W;
  const first = Math.max(0, spec.from ?? 0);
  const last = Math.min(along - 1, spec.to ?? along - 1);
  // Rounded, because it is added to a coordinate. A fractional bend point indexes the board between
  // cells, every lookup there reads undefined, and the bend is refused every time it is offered — it
  // was a silent no-op on every line whose planet extent was not a multiple of the share.
  const longRun = Math.round(LONG_RUN_SHARE * (spec.axis === 'y' ? board.extent.h : board.extent.w));
  const every = lerpClamped(STAGGER_EVERY.low, STAGGER_EVERY.high, richness);
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
      if (!due || nearHub(board, spec.axis, line, cross.a) || keepsRing(board, spec.axis, line, cross.a)) continue;
      if (onCrown(board, crown, spec.axis, line, cross.a)) continue;
      const jog = jogFor(board, { ...spec, line }, laid, seed, { from: cross.a, last });
      if (jog === 0) continue;
      // And the crossing street has to carry the step. The two legs of a stagger are joined by the
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
    // The street is due a turn and nothing crosses it (the bent road, the fourth junction form). The
    // two legs are joined by a short link across the step, so the bend is one walk with a corner in
    // it rather than two streets that happen to be near each other.
    //
    // A refused bend is postponed, not abandoned. Giving up on the line the first time its ground,
    // its hub ring or its crown said no let the rest of it run straight to the coast, which is the
    // planet-spanning street this whole operator exists to remove. The point of the turn walks on instead, and a
    // crossing that appears before the new one is taken in its place.
    if (bendAt >= last) break;
    if (nearHub(board, spec.axis, line, bendAt) || keepsRing(board, spec.axis, line, bendAt) || onCrown(board, crown, spec.axis, line, bendAt)) {
      postpone += BEND_RETRY;
      continue;
    }
    const jog = jogFor(board, { ...spec, line }, laid, seed, { from: bendAt, last });
    // And the link's own ground has to carry it, whole. A bend whose link the ground refuses leaves
    // two legs that never meet: the near one is a street ending in open grass and the far one is
    // pavement the plaza reaches by some other route or not at all.
    if (jog === 0 || !linkable(board, spec, line, line + jog, bendAt)) {
      postpone += BEND_RETRY;
      continue;
    }
    legs.push({ ...spec, line, from, to: bendAt });
    // The link runs between the two legs' own coordinates and no further: `stampOf` already spreads
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
 * around the hub and the four spines of the centre-to-rim gradient are the same four lines. A ring that steps aside at
 * its own corner does not close: one seed comes back with a third of its pavement gone, every street
 * beyond the broken corner pruned for being unreachable from a plaza no street touched. So the anti-grid
 * rule starts outside the hub.
 */
function nearHub(board: Board, axis: 'x' | 'y', line: number, at: number): boolean {
  const x = axis === 'y' ? line : at;
  const y = axis === 'y' ? at : line;
  const p = board.hubArea;
  const dx = Math.max(p.x - x, 0, x - (p.x + p.w - 1));
  const dy = Math.max(p.y - y, 0, y - (p.y + p.h - 1));
  return Math.max(dx, dy) <= RING_KEEP;
}

/**
 * Whether a line that runs alongside the plaza has yet to pass it at `at`: it lies within the ring's
 * reach of the plaza across its own axis, and the plaza's far end along it is still ahead.
 *
 * A stagger moves the whole rest of the line, so one taken on the way toward the plaza carries the
 * leg that should run past the plaza's face somewhere else: across the plaza, where the ground holds
 * no street, or a terrace away, and the ring it was one side of never closes. Whether a crossing
 * falls before the plaza or not is a matter of a cell or two, so `nearHub` alone made the hub's
 * network flip between whole and pruned away as the plaza moved by one cell. The line keeps its
 * coordinate until it is past the plaza; from there on it staggers as any other line does.
 */
function keepsRing(board: Board, axis: 'x' | 'y', line: number, at: number): boolean {
  const p = board.hubArea;
  const [lo, hi] = axis === 'y' ? [p.x, p.x + p.w - 1] : [p.y, p.y + p.h - 1];
  const across = Math.max(lo - line, 0, line - hi);
  const end = axis === 'y' ? p.y + p.h - 1 : p.x + p.w - 1;
  return across <= RING_KEEP && at <= end + RING_KEEP;
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

/** Whether the line's stamp at `t` stands on pavement laid by a street of the other axis. */
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
  board: Board, spec: LineSpec, laid: readonly StreetRun[], seed: number, at: { from: number; last: number },
): number {
  const { from, last } = at;
  const span = spec.axis === 'y' ? board.W : board.H;
  const roll = hash01(mix(seed, mix(spec.line, from)), 0x5bf0);
  const drawn = JOG_MIN + Math.floor(roll * (JOG_MAX - JOG_MIN + 1));
  const signs = hash01(mix(seed, from), spec.line) < 0.5 ? [-1, 1] : [1, -1];
  // The size is negotiable, the step is not. The draw picks how far across the line would like to
  // step; where that lands on ground the street cannot run on, a shorter step is still a step, and
  // the alternative is the line running on to the coast as a planet-spanning street.
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
  const p = board.hubArea;
  const o = (TRUNK_W - 1) >> 1;
  // West, north, east, south: a turning order, so every trunk crosses the one laid before it at a
  // corner of the plaza's ring.
  const trunks: LineSpec[] = [
    { rank: 'trunk', axis: 'y', line: p.x - TRUNK_W + o, width: TRUNK_W },
    { rank: 'trunk', axis: 'x', line: p.y - TRUNK_W + o, width: TRUNK_W },
    { rank: 'trunk', axis: 'y', line: p.x + p.w + o, width: TRUNK_W },
    { rank: 'trunk', axis: 'x', line: p.y + p.h + o, width: TRUNK_W },
  ];
  const spacing = lerpClamped(SPACING.low, SPACING.high, richness);
  const branches: LineSpec[] = [];
  for (const axis of ['y', 'x'] as const) {
    const span = axis === 'y' ? board.W : board.H;
    const lo = axis === 'y' ? p.x - TRUNK_W + o : p.y - TRUNK_W + o;
    const hi = axis === 'y' ? p.x + p.w + o : p.y + p.h + o;
    // Each gap is drawn separately, so the blocks come out unequal. An exactly ruled grid reads as
    // graph paper and gives every block the same area; a town wants a wide block-size spread at one
    // pavement share, and unequal gaps are where that spread comes from. The draw is positional, not off the rng stream, so a line's
    // spacing does not move when an earlier line's search does.
    for (const side of [-1, 1] as const) {
      let at = side < 0 ? lo : hi;
      for (let k = 1; ; k++) {
        const grown = spacing * (1 + SPACING_GROWTH * (k - 1));
        at += side * Math.round(grown * lerpClamped(1 - SPACING_SPREAD, 1 + SPACING_SPREAD, hash01(mix(seed, axis === 'y' ? 1 : 2), side * k)));
        if (at < 0 || at >= span) break;
        branches.push({ rank: 'branch', axis, line: at, width: BRANCH_W });
      }
    }
  }
  // Nearest the hub first, so a branch meets the network the trunks already laid.
  const hubOf = (s: LineSpec): number => Math.abs(s.line - (s.axis === 'y' ? board.hub.x : board.hub.y));
  branches.sort((a, b) => hubOf(a) - hubOf(b) || (a.axis < b.axis ? -1 : 1) || a.line - b.line);
  // The walk is widest where it leaves the plaza. An approach reads 4 to 6 cells against a 3-wide
  // trunk, which is what a street does as it nears the centre; a 4-wide line all the way to the coast
  // would put three quarters of the map's pavement at trunk width.
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
 * A street along every block the grid left unserved, raised or flat. A full-planet line meeting a
 * terrace across its short side lays a piece shorter than a street, which is dropped and leaves the
 * terrace bare; a coast, the plaza ring or the settling's pruning leave unserved blocks on flat
 * planets too. There is no tier test, so the quiet end of the richness axis lays more of these,
 * which sets the paved-share and district-count ceilings.
 *
 * Each unserved block is offered a line down its own long axis, bounded to its extent, asked for
 * after the grid so it never paves what the grid serves; from there it is a branch like any other.
 */
function unservedBlockLines(board: Board, composition: CompositionPlan): LineSpec[] {
  const out: LineSpec[] = [];
  for (const block of cutDistricts(board, composition)) {
    if (block.served || block.cells.length < ENTRY_MIN_CELLS) continue;
    const r = block.rect;
    if (Math.min(r.w, r.h) < BLOCK_LINE_INSET + BRANCH_W || Math.max(r.w, r.h) < PIECE_MIN) continue;
    // Along the foot of the block, not down its middle: that is where a terraced planet's roads run,
    // it leaves the block one straight frontage rather than two half-blocks, and where the
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
 * That side is the terrace's foot — the side a flight can climb to, since the low ground the ramps
 * run down lies outside it, and the side a terraced planet's roads run along.
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
 * lying on a step is unpavable along its whole length (the flat trait reads the step), and a line one
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
