/**
 * A ROUTE BETWEEN TWO POINTS, decided rather than stumbled into.
 *
 * Pure: analysis, portal candidates and the standing road set in, a plan out. It places nothing,
 * validates nothing and reads no catalog — `road-link.ts` realizes the plan through `tryPlace`, and
 * a plan that the rules then refuse in part is still the plan that was drawn, which is what lets the
 * ghost and the press agree.
 *
 * The four quality rules of the design live here and nowhere else:
 *  1. STRAIGHTEN. A* returns the cheapest walk, which on open ground is a staircase. The path is
 *     consolidated into long runs and deliberate L bends, and two bends may not fall within
 *     `MIN_RUN` cells of each other. A few extra cells of length is the price and it is deliberate.
 *  2. CHOOSE THE CROSSING, FOR THIS TRIP. Candidates are scored first by how far off the line
 *     between the two points they lie, then by span (narrowest), squareness (the deck across the
 *     water rather than askew to it) and approach (a straight run-in on BOTH banks) — and the chain
 *     of regions is weighed the same way, not by the graph's edge cost, which only ever knew
 *     "bridge" from "ramp". A crossing chosen on its own merits alone sends the road fifteen cells
 *     out of its way and twenty back for an eleven-cell trip, which is what a player sees.
 *  3. PLAN THE APPROACH. A ramp lands on the terrace face the route is TRAVELLING TOWARD and the
 *     straight run-in is part of the plan, so a bend can never land on the transition.
 *  4. JOIN SQUARE. Where the route meets standing pavement it meets it as a T or as a collinear
 *     extension; a meeting of three ways or more earns a small pad.
 */
import type { MacroCoord } from '../../../core/model/types';
import { NEIGHBORS4, type Rect } from '../../../core/model/grid-model';
import { clamp01 } from '../../../core/model/math';
import { TUNING } from '../tuning';
import { astar, nearestWalkable, type AstarCost } from './network';
import { buildingGate } from './object';
import { routeRegionsMulti, type Portal } from './portals';
import type { PlacementAnalysis } from './analysis';
import type { RoadStyle } from './road-style';

export type RouteProfile = 'straight' | 'short' | 'scenic';

/** The map as the planner reads it. Every field is DATA: the caller scans, the planner decides. */
export interface RouteWorld {
  a: PlacementAnalysis;
  /** Validated crossing sites (`scanPortals`), and the region graph over them. */
  portals: readonly Portal[];
  regionAdj: Map<number, Portal[]>;
  /** Flat indices carrying a coating today. Cheap to route over (`TUNING.roadReuseCost`). */
  road: ReadonlySet<number>;
  /** Flat indices an unlocked object footprint holds. A route goes AROUND these. */
  occupied: ReadonlySet<number>;
  /** A BRIDGE IS A ROAD. Flat indices a bridge or ramp ALREADY STANDING covers, plus the cells at
   *  its two entrances: a route crosses one exactly as it crosses pavement. The deck's own cells are
   *  in `occupied` too and stay there — nothing is laid on a deck and nothing about it is touched —
   *  but they are not something in the way, so they never reach `blocked`. Absent on a map with no
   *  crossing on it, and on every caller that has none to declare. */
  deck?: ReadonlySet<number>;
  style: RoadStyle;
}

/** One straight leg of the plan. A leg never bends, so a bend is always a leg boundary. */
export interface RouteLeg {
  cells: MacroCoord[];
  /** The crossing this leg runs ONTO, when it ends at one. The deck's own cells are not paved. */
  crossing?: Portal;
}

export interface RoutePlan {
  profile: RouteProfile;
  from: MacroCoord;
  to: MacroCoord;
  legs: RouteLeg[];
  /** Every cell to pave, in walk order, start first, decks excluded. */
  cells: MacroCoord[];
  /** The crossings to realize, in the order the route meets them. */
  crossings: readonly Portal[];
  /** The pad a three-way-plus meeting earns, beyond `cells`. */
  pads: MacroCoord[];
  /** Cells the route NEEDS that an unlocked decoration holds. The run leaves every one standing;
   *  the ghost marks them. Empty on a route that found a way round. */
  blocked: MacroCoord[];
  /** Total step cost, so offers can be compared and ordered without re-running A*. */
  cost: number;
}

/** No two bends within this many cells, and no run shorter than it except at the ends. */
export const MIN_RUN = 3;
/** How many cells of extra length an L may cost over the walk it replaces. */
export const STRAIGHTEN_SLACK = 2;

const idxAt = (c: MacroCoord, W: number): number => c.y * W + c.x;
const manhattan = (a: MacroCoord, b: MacroCoord): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const sameCell = (a: MacroCoord, b: MacroCoord): boolean => a.x === b.x && a.y === b.y;

/** Straight-line passability between two cells that share an axis (inclusive of both ends). */
function lineOk(a: MacroCoord, b: MacroCoord, passable: (x: number, y: number) => boolean): boolean {
  if (a.x === b.x) {
    const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
    for (let y = lo; y <= hi; y++) if (!passable(a.x, y)) return false;
    return true;
  }
  if (a.y === b.y) {
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
    for (let x = lo; x <= hi; x++) if (!passable(x, a.y)) return false;
    return true;
  }
  return false; // not axis-aligned — not a single straight run
}

/** The real per-step cost of entering `to` from `from`, given the direction the walk already held
 *  arriving at `from` (`null` when `from` is the very start of the stretch being priced — no prior
 *  direction to compare against, so no turn cost applies). A caller mirrors `astar`'s own inner-loop
 *  arithmetic (network.ts) exactly, so `straighten` can compare a substitute's TRUE cost against the
 *  window it would replace, not merely its length. */
export type StepCost = (from: MacroCoord, to: MacroCoord, prevDir: readonly [number, number] | null) => number;

const dirOfStep = (a: MacroCoord, b: MacroCoord): [number, number] => [Math.sign(b.x - a.x), Math.sign(b.y - a.y)];
const sameDir = (a: readonly [number, number] | null, b: readonly [number, number]): boolean => !!a && a[0] === b[0] && a[1] === b[1];

/** Expands two axis-aligned points into the per-cell walk between them (inclusive of both ends) —
 *  the one place a straight run's cells are enumerated, shared by pricing and by the final output. */
function expandRun(from: MacroCoord, to: MacroCoord): MacroCoord[] {
  const out: MacroCoord[] = [from];
  if (from.x === to.x) { const step = to.y > from.y ? 1 : -1; for (let y = from.y + step; ; y += step) { out.push({ x: from.x, y }); if (y === to.y) break; } }
  else { const step = to.x > from.x ? 1 : -1; for (let x = from.x + step; ; x += step) { out.push({ x, y: from.y }); if (x === to.x) break; } }
  return out;
}

/** Total cost of walking `cells` (a real per-cell 4-connected sequence), given the direction the
 *  walk already held arriving at `cells[0]`. */
function walkCost(cells: readonly MacroCoord[], enterDir: readonly [number, number] | null, stepCost: StepCost): number {
  let cost = 0, dir = enterDir;
  for (let k = 1; k < cells.length; k++) {
    cost += stepCost(cells[k - 1]!, cells[k]!, dir);
    dir = dirOfStep(cells[k - 1]!, cells[k]!);
  }
  return cost;
}

/** Cost of a straight line (`corner` null) or an L (`corner` set) from `from` to `to`. */
function runCost(from: MacroCoord, corner: MacroCoord | null, to: MacroCoord, enterDir: readonly [number, number] | null, stepCost: StepCost): number {
  if (!corner) return walkCost(expandRun(from, to), enterDir, stepCost);
  return walkCost(expandRun(from, corner), enterDir, stepCost) + walkCost(expandRun(corner, to), dirOfStep(from, corner), stepCost);
}

const COST_EPS = 1e-9; // floating-point tolerance: an exact tie still prefers the L (the neutral case)

/**
 * The walk, consolidated. Every window of the path is offered the two L substitutions between its
 * ends (across-then-down, down-then-across); the first that is passable end to end replaces it.
 * Longest windows first, so a staircase collapses to ONE L rather than to a shorter flight of them.
 * A second pass merges any pair of bends left within `MIN_RUN`, extending the earlier leg through
 * the later one where that is passable.
 *
 * `stepCost`, when given, is what actually gates a substitution: it must cost no more than the raw
 * window it would replace (a tie still prefers the L — the neutral, turnPenalty-free case this
 * degenerates to on open ground). Without it, the gate is purely geometric — no more than
 * `STRAIGHTEN_SLACK` extra cells — which is what every caller that never threads a profile through
 * keeps getting, unchanged. A profile's discount-motivated detour is genuinely LONGER than the
 * direct line only because it is genuinely CHEAPER under that profile's own cost function; without
 * `stepCost` this function has no way to know that, and would snap the detour straight back to the
 * direct line the moment that line is merely passable — which is exactly the bug `stepCost` exists
 * to close.
 */
export function straighten(
  path: readonly MacroCoord[], passable: (x: number, y: number) => boolean, stepCost?: StepCost,
): MacroCoord[] {
  if (path.length <= 2) return [...path];

  // Pass 1: largest-window-first L (or straight-line) substitution.
  let pts: MacroCoord[] = [path[0]!];
  let i = 0;
  let enterDir: readonly [number, number] | null = null; // direction held arriving at path[i]
  while (i < path.length - 1) {
    let bestJ = i + 1;
    let bestCorner: MacroCoord | null = null;
    for (let j = path.length - 1; j > i; j--) {
      const a = path[i]!, b = path[j]!;
      const windowLen = j - i; // steps, so window cell count is windowLen + 1
      const rawCost = stepCost ? walkCost(path.slice(i, j + 1), enterDir, stepCost) : 0;
      if (a.x === b.x || a.y === b.y) {
        if (!lineOk(a, b, passable)) continue;
        const accept = stepCost
          ? runCost(a, null, b, enterDir, stepCost) <= rawCost + COST_EPS
          : manhattan(a, b) - windowLen <= STRAIGHTEN_SLACK;
        if (accept) { bestJ = j; bestCorner = null; break; }
        continue;
      }
      const across: MacroCoord = { x: b.x, y: a.y };
      const down: MacroCoord = { x: a.x, y: b.y };
      const acrossOk = lineOk(a, across, passable) && lineOk(across, b, passable);
      const downOk = lineOk(a, down, passable) && lineOk(down, b, passable);
      if (stepCost) {
        if (acrossOk && runCost(a, across, b, enterDir, stepCost) <= rawCost + COST_EPS) { bestJ = j; bestCorner = across; break; }
        if (downOk && runCost(a, down, b, enterDir, stepCost) <= rawCost + COST_EPS) { bestJ = j; bestCorner = down; break; }
      } else {
        if (manhattan(a, b) - windowLen > STRAIGHTEN_SLACK) continue;
        if (acrossOk) { bestJ = j; bestCorner = across; break; }
        if (downOk) { bestJ = j; bestCorner = down; break; }
      }
    }
    if (bestCorner) pts.push(bestCorner);
    pts.push(path[bestJ]!);
    enterDir = bestCorner ? dirOfStep(bestCorner, path[bestJ]!) : dirOfStep(path[i]!, path[bestJ]!);
    i = bestJ;
  }

  // Pass 2: merge any two interior bends left within MIN_RUN, extending the earlier leg through the
  // later one — the endpoints (the very first and last runs) are exempt. Geometric, unconditionally
  // (no `stepCost` gate): MIN_RUN spacing is a hard guarantee, not a preference a cost may override.
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let k = 1; k < pts.length - 2; k++) {
      if (manhattan(pts[k]!, pts[k + 1]!) >= MIN_RUN) continue;
      const a = pts[k - 1]!, b = pts[k + 2]!;
      if (a.x === b.x || a.y === b.y) {
        if (lineOk(a, b, passable)) { pts = [...pts.slice(0, k), ...pts.slice(k + 2)]; changed = true; break; }
        continue;
      }
      const across: MacroCoord = { x: b.x, y: a.y };
      const down: MacroCoord = { x: a.x, y: b.y };
      if (lineOk(a, across, passable) && lineOk(across, b, passable)) { pts = [...pts.slice(0, k), across, ...pts.slice(k + 2)]; changed = true; break; }
      if (lineOk(a, down, passable) && lineOk(down, b, passable)) { pts = [...pts.slice(0, k), down, ...pts.slice(k + 2)]; changed = true; break; }
    }
  }

  // Expand the vertex list back into a per-cell walk (straighten's callers want cells, not corners).
  const out: MacroCoord[] = [pts[0]!];
  for (let v = 1; v < pts.length; v++) out.push(...expandRun(pts[v - 1]!, pts[v]!).slice(1));
  return out;
}

/** How good a crossing site is, decomposed so a test can say WHICH term rejected a candidate.
 *  Higher is better; every term is normalized to 0..1 and the weights are named constants. */
export interface CrossingScore {
  /** 1 when the site sits ON the line between the two points being joined, falling away as the
   *  round trip out to it and back grows against the trip itself. */
  detour: number;
  /** Narrow spans score high: a four-cell ford beats an eight-cell one. */
  span: number;
  /** 1 when the deck's own axis lines up with the direction of travel toward the goal — the
   *  zero-detour crossing a route walks straight through — falling off as the angle away from
   *  that axis grows (a crossing that would need a jog to reach and use). */
  square: number;
  /** 1 when both banks offer `APPROACH_DEPTH` straight open cells in line with the deck. */
  approach: number;
  total: number;
}
export const APPROACH_DEPTH = 2;

/** DETOUR OUTWEIGHS EVERY OTHER MERIT, and by a distance: a narrower span fifteen cells east is a
 *  worse crossing than a wide one on the line, because the road has to walk there and back. The
 *  other three terms decide between sites the trip passes anyway. */
const DETOUR_WEIGHT = 0.55, SPAN_WEIGHT = 0.2, SQUARE_WEIGHT = 0.15, APPROACH_WEIGHT = 0.1;
/** The trip's own length is what a detour is read against — twenty cells out of the way is a
 *  different thing on an eleven-cell trip than on a hundred-cell one — floored so that two taps a
 *  few cells apart do not make every site on the map look equally hopeless. */
const DETOUR_FLOOR = 8;

/** How many cells further the trip runs for going through `anchor`. Manhattan, so it is 0 for any
 *  anchor inside the box the two points span and grows with the distance outside it. */
export function crossingDetour(anchor: MacroCoord, from: MacroCoord, to: MacroCoord): number {
  return manhattan(from, anchor) + manhattan(anchor, to) - manhattan(from, to);
}

const detourScore = (anchor: MacroCoord, from: MacroCoord, to: MacroCoord): number =>
  1 / (1 + crossingDetour(anchor, from, to) / Math.max(DETOUR_FLOOR, manhattan(from, to)));

/** The straight run-in cells on one bank: `APPROACH_DEPTH` cells stepping away from the deck along
 *  the deck's OWN axis. These are part of the plan, which is what keeps a bend off the transition. */
export function approachRun(p: Portal, side: 'A' | 'B', depth = APPROACH_DEPTH): MacroCoord[] {
  const near = side === 'A' ? p.approachA : p.approachB;
  const far = side === 'A' ? p.approachB : p.approachA;
  const axisX = near.y === far.y; // the two approaches share the deck's cross-axis coordinate
  const dir = axisX ? (Math.sign(near.x - far.x) || 1) : (Math.sign(near.y - far.y) || 1);
  const out: MacroCoord[] = [];
  for (let k = 0; k < depth; k++) out.push(axisX ? { x: near.x + dir * k, y: near.y } : { x: near.x, y: near.y + dir * k });
  return out;
}

/** How good a crossing site is FOR THIS TRIP: a site on the way between `from` and `to` wins over
 *  one the route would have to walk out to and back from, a narrow span wins, a deck whose OWN AXIS
 *  lines up with the direction of travel toward `to` wins (you walk straight onto it and straight
 *  off it again, rather than jogging 90° to reach a deck that runs across your path), and both banks
 *  must offer a clear straight run-in. `route.ts` reads no terrain beyond `world.a`, so squareness is
 *  read against the travel direction rather than an explicit shoreline. */
export function scoreCrossing(world: RouteWorld, p: Portal, from: MacroCoord, to: MacroCoord): CrossingScore {
  const { width: W, height: H, open } = world.a;
  const axisX = p.approachA.y === p.approachB.y;
  const span = manhattan(p.approachA, p.approachB);
  const spanScore = 1 / (1 + span);
  const detour = detourScore(p.anchor, from, to);

  const travelDx = to.x - p.anchor.x, travelDy = to.y - p.anchor.y;
  const travelLen = Math.hypot(travelDx, travelDy) || 1;
  // How much of the travel runs ALONG the deck's own axis: 1 when travel is purely along it (the
  // deck sits directly on the line to the goal — zero detour), 0 when travel is purely perpendicular
  // to it (the deck runs square ACROSS the path, so reaching it costs a 90° jog either way).
  const alongDeck = axisX ? Math.abs(travelDx) / travelLen : Math.abs(travelDy) / travelLen;
  const square = clamp01(alongDeck);

  const withinOpen = (c: MacroCoord): boolean => c.x >= 0 && c.y >= 0 && c.x < W && c.y < H && open[idxAt(c, W)] === 1;
  const approach = approachRun(p, 'A').every(withinOpen) && approachRun(p, 'B').every(withinOpen) ? 1 : 0;

  const total = detour * DETOUR_WEIGHT + spanScore * SPAN_WEIGHT + square * SQUARE_WEIGHT + approach * APPROACH_WEIGHT;
  return { detour, span: spanScore, square, approach, total };
}

/**
 * Make the meeting square. Where the tail of `path` lands on standing pavement, the last
 * `MIN_RUN` cells are forced collinear with the join direction (a T), or the join is taken one cell
 * further along an existing run (a collinear extension). A junction where three or more paved
 * directions meet earns the four cells of the corner pad, which is what stops a fork reading as a
 * frayed end.
 */
export function squareJunction(
  path: readonly MacroCoord[], road: ReadonlySet<number>, passable: (x: number, y: number) => boolean, W: number,
): { cells: MacroCoord[]; pads: MacroCoord[] } {
  if (path.length < 2) return { cells: [...path], pads: [] };
  const onRoad = (c: MacroCoord): boolean => road.has(idxAt(c, W));
  const orth = (c: MacroCoord): MacroCoord[] => [
    { x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 },
  ];
  const last = path[path.length - 1]!;
  const meets = onRoad(last) || orth(last).some(onRoad);
  if (!meets) return { cells: [...path], pads: [] };
  const joinCell = onRoad(last) ? last : orth(last).find(onRoad)!;

  // The direction the route arrives from: the last distinct point walking back from the join.
  let back = path.length - 1;
  while (back > 0 && sameCell(path[back]!, joinCell)) back--;
  const from = path[back]!;
  let dx = Math.sign(joinCell.x - from.x), dy = Math.sign(joinCell.y - from.y);
  if (dx === 0 && dy === 0) { dx = 0; dy = 1; }

  const forced: MacroCoord[] = [];
  for (let k = MIN_RUN - 1; k >= 0; k--) forced.push({ x: joinCell.x - dx * k, y: joinCell.y - dy * k });
  const straightOk = forced.every((c) => passable(c.x, c.y));
  const head = path.slice(0, Math.max(0, path.length - MIN_RUN));
  const cells = straightOk && path.length >= MIN_RUN ? [...head, ...forced] : [...path];

  // Every paved direction the join cell already carries, plus the leg arriving, earns the pad once
  // three or more ways meet — a fork, not a T.
  const pavedWays = orth(joinCell).filter(onRoad).length + 1;
  let pads: MacroCoord[] = [];
  if (pavedWays >= 3) {
    const perp: [number, number] = [-dy, dx];
    pads = [
      { x: joinCell.x + perp[0], y: joinCell.y + perp[1] },
      { x: joinCell.x - perp[0], y: joinCell.y - perp[1] },
      { x: joinCell.x + dx + perp[0], y: joinCell.y + dy + perp[1] },
      { x: joinCell.x + dx - perp[0], y: joinCell.y + dy - perp[1] },
    ].filter((c) => passable(c.x, c.y));
  }
  return { cells, pads };
}

/** A building's gate strip, nearest the gate first: where a road SERVING it must terminate.
 *  `buildingGate` gives the 3-wide by 2-deep strip; this orders it so the terminal pass tries the
 *  approach cell, then its two shoulders, then the gate row. */
export function gateTerminalCells(rect: Rect, rotation: 0 | 90 | 180 | 270): MacroCoord[] {
  const { clear } = buildingGate(rect, rotation);
  const gateRow = clear.slice(0, 3), approachRow = clear.slice(3, 6);
  return [approachRow[1]!, approachRow[0]!, approachRow[2]!, gateRow[0]!, gateRow[1]!, gateRow[2]!];
}

/** Whether (x, y) is a cell the route may cross: standing road, a standing crossing's deck, or open
 *  ground. `allowOccupied` additionally opens an unlocked decoration's cell — the fallback pass a leg
 *  takes when nothing else reaches the goal, so the plan reports the cell as blocked rather than
 *  failing outright. */
function passableOf(world: RouteWorld, allowOccupied: boolean): (x: number, y: number) => boolean {
  const { a, road, occupied, deck } = world;
  const W = a.width, H = a.height;
  return (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = y * W + x;
    if (road.has(i) || deck?.has(i)) return true;
    if (allowOccupied && occupied.has(i)) return true;
    return a.open[i] === 1;
  };
}

/** Whether `i` sits along a terrace/cliff edge: an in-bounds orthogonal neighbour on a different
 *  buildable elevation. The scenic profile discounts these the same as water and for the same
 *  reason — a change of level is something to look at, not just cross. */
function edgeAdjacent(a: PlacementAnalysis, i: number): boolean {
  const { width: W, height: H, elev } = a;
  const x = i % W, y = (i / W) | 0;
  for (const [dx, dy] of NEIGHBORS4) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    if (elev[ny * W + nx] !== elev[i]) return true;
  }
  return false;
}

/** How much more a turn costs the profile that hates turning. */
const STRAIGHT_TURN = TUNING.styleTurnPenaltyMax * 2;
/** What a cell beside water or a terrace edge is discounted by for the scenic profile, and how far
 *  from water still counts as beside it. */
const SCENIC_BONUS = 0.35;
const SCENIC_REACH = 3;
/** What a step ALONG a standing street's own axis is discounted by, so a new route extends a line
 *  rather than cutting past it. Smaller than `roadReuseCost`: joining is cheaper than paralleling,
 *  and paralleling is cheaper than ignoring. */
const ALIGN_BONUS = 0.2;
/** The smallest positive cost a step may still carry once every bonus has stacked. `astar`'s
 *  closed-set optimization (`network.ts`) settles a node the moment it is popped and never
 *  re-relaxes it — sound only over non-negative edges. `ALIGN_BONUS` alone stays under
 *  `roadReuseCost` (0.2 < 0.25), but the 'scenic' profile ADDS `SCENIC_BONUS` on top of it
 *  (0.2 + 0.35 = 0.55 > 0.25), which can otherwise drive a road-reuse step negative. `capEnter`
 *  floors the COMBINED discount against the actual base cost the entered cell will pay — road
 *  reuse or plain ground, whichever `i` is — rather than shrinking the bonus constants themselves,
 *  so a future bonus stacked on top can never reopen this by surprise. */
const MIN_EDGE_COST = 0.01;

/** Caps a profile's raw (possibly very negative) discount so `baseStepCost(i) + capped` never drops
 *  to or below zero — the invariant `astar`'s optimization needs. Exported for the unit test that
 *  proves it holds for an arbitrarily negative `raw`, not only today's specific bonus values. */
export function capEnter(world: RouteWorld, i: number, raw: number): number {
  const base = world.road.has(i) ? TUNING.roadReuseCost : TUNING.roadCost;
  return Math.max(raw, MIN_EDGE_COST - base);
}

/** Each profile's extra cost, layered on `astar`'s classic arithmetic — the only thing in this file
 *  that reads `AstarCost`. 'straight' pays double the map's own worst turn cost to keep to long
 *  runs; 'short' is the map's own style, discounted only for joining a standing street's line;
 *  'scenic' adds that same join discount plus a bonus for hugging water or a terrace edge. */
function profileCost(world: RouteWorld, profile: RouteProfile): AstarCost {
  const { a, style } = world;
  const align = (i: number, prev: number): number => {
    const axis = style.alignment.get(i);
    if (!axis) return 0;
    const straightX = Math.abs(i - prev) === 1;
    return (axis === 'x') === straightX ? -ALIGN_BONUS : 0;
  };
  switch (profile) {
    case 'straight':
      return { turn: () => STRAIGHT_TURN, enter: (i, prev) => capEnter(world, i, align(i, prev)) };
    case 'short':
      return { enter: (i, prev) => capEnter(world, i, align(i, prev)) };
    case 'scenic':
      return {
        enter: (i, prev) => capEnter(world, i, align(i, prev)
          + (a.distToWater[i]! <= SCENIC_REACH || edgeAdjacent(a, i) ? -SCENIC_BONUS : 0)),
      };
  }
}

/** Builds the `StepCost` `straighten` compares substitutes against, mirroring `astar`'s own
 *  inner-loop arithmetic (network.ts) exactly: the base road/ground step, the turn cost (a
 *  profile's own override, or the map's `turnPenalty`), and the profile's `enter` bonus. The two
 *  formulas are kept in lockstep on purpose — a substitute is only ever accepted for costing no
 *  more than what A* itself would have paid for the window it replaces. */
function toStepCost(world: RouteWorld, cost: AstarCost | undefined): StepCost {
  const { road, style, a } = world;
  const W = a.width;
  return (from, to, prevDir) => {
    const stepDir = dirOfStep(from, to);
    const iTo = idxAt(to, W), iFrom = idxAt(from, W);
    const base = road.has(iTo) ? TUNING.roadReuseCost : TUNING.roadCost;
    const turn = style.turnPenalty > 0 && prevDir !== null && !sameDir(prevDir, stepDir)
      ? (cost?.turn?.(iTo, iFrom) ?? style.turnPenalty) : 0;
    return base + turn + (cost?.enter?.(iTo, iFrom) ?? 0);
  };
}

/** A* one leg (strict first — never through an unlocked decoration; the occupied fallback only if
 *  that fails), straightened, with any occupied cell it still had to cross spliced out and reported
 *  into `blocked` rather than paved over. Null when neither pass reaches `to` at all. */
function buildLegCells(world: RouteWorld, from: MacroCoord, to: MacroCoord, blocked: Set<number>, cost: AstarCost | undefined): MacroCoord[] | null {
  const { a, road, occupied, deck, style } = world;
  const W = a.width, H = a.height;
  const maxNodes = Math.max(TUNING.networkMaxNodesFloor, W * H);
  const roadSet = road as Set<number>; // astar only ever reads it
  const goals = new Set<number>([idxAt(to, W)]);
  const strict = passableOf(world, false);
  let path = astar(from, goals, strict, W, H, roadSet, to, maxNodes, style.turnPenalty, cost);
  let used = strict;
  if (!path) { used = passableOf(world, true); path = astar(from, goals, used, W, H, roadSet, to, maxNodes, style.turnPenalty, cost); }
  if (!path) return null;
  const straightened = straighten(path, used, toStepCost(world, cost));
  const cells: MacroCoord[] = [];
  for (const c of straightened) {
    const i = idxAt(c, W);
    // A deck's own cells are walked and left alone: an object holds them, so they take no tile, and
    // they are the route working rather than the route obstructed. The entrance cells beside them
    // are ordinary ground and ARE paved, which is what puts the road at the deck.
    if (deck?.has(i)) { if (!occupied.has(i)) cells.push(c); continue; }
    if (occupied.has(i)) blocked.add(i); else cells.push(c);
  }
  return cells;
}

/** Appends `next` onto `base`, dropping `next`'s first cell when it duplicates `base`'s last — the
 *  seam every leg/run stitch crosses (a run's own head is the previous piece's tail). */
function appendPath(base: readonly MacroCoord[], next: readonly MacroCoord[]): MacroCoord[] {
  if (!next.length) return [...base];
  if (base.length && sameCell(base[base.length - 1]!, next[0]!)) return [...base, ...next.slice(1)];
  return [...base, ...next];
}

/** Splits one consolidated walk into its maximal straight runs — `RouteLeg.cells` never bends, so a
 *  bend is always a leg boundary, and the bend cell itself belongs to both of its adjoining legs (it
 *  is the corner both runs turn at). Directions are compared by SIGN, not raw delta, so a leg missing
 *  a `blocked` cell in its interior (a gap, not a turn) is not mistaken for one. */
function splitLegs(cells: readonly MacroCoord[]): MacroCoord[][] {
  if (cells.length === 0) return [];
  if (cells.length === 1) return [[cells[0]!]];
  const dirOf = (a: MacroCoord, b: MacroCoord): [number, number] => [Math.sign(b.x - a.x), Math.sign(b.y - a.y)];
  const legs: MacroCoord[][] = [];
  let cur: MacroCoord[] = [cells[0]!];
  let dir: [number, number] = dirOf(cells[0]!, cells[1]!);
  cur.push(cells[1]!);
  for (let i = 2; i < cells.length; i++) {
    const d = dirOf(cells[i - 1]!, cells[i]!);
    if (d[0] !== dir[0] || d[1] !== dir[1]) { legs.push(cur); cur = [cells[i - 1]!]; dir = d; }
    cur.push(cells[i]!);
  }
  legs.push(cur);
  return legs;
}

const crossingCost = (kind: Portal['kind']): number => (kind === 'bridge' ? TUNING.portalBridgeCost : TUNING.portalRampCost);

export function planRoute(world: RouteWorld, from: MacroCoord, to: MacroCoord, profile: RouteProfile): RoutePlan | null {
  const { a, regionAdj, portals, road } = world;
  const W = a.width, H = a.height;
  const astarCost = profileCost(world, profile);

  const occupiedSet = world.occupied as Set<number>;
  const start = nearestWalkable(from, a, occupiedSet, W, H);
  const goal = nearestWalkable(to, a, occupiedSet, W, H);
  if (!start || !goal) return null;

  const startRegion = a.region[idxAt(start, W)] ?? -1;
  const goalRegion = a.region[idxAt(goal, W)] ?? -1;
  const blocked = new Set<number>();
  /** One entry per GROUP (the stretch between two crossings, or into the goal) — split into its own
   *  straight-run legs only once every group is assembled, so the final group can still be squared
   *  against standing pavement before it is cut into legs. */
  const groups: { cells: MacroCoord[]; crossing?: Portal }[] = [];

  // A DIRECT leg is tried first regardless of region match: an unlocked decoration sitting on the
  // only line splits `a.region` (the analysis excludes every occupied cell alike), so "different
  // region" is only ever a HINT that a crossing may be needed, never proof one is — the occupied
  // fallback inside `buildLegCells` already crosses exactly that kind of gap.
  const direct = buildLegCells(world, start, goal, blocked, astarCost);
  if (direct) {
    groups.push({ cells: direct });
  } else if (startRegion < 0 || goalRegion < 0 || startRegion === goalRegion) {
    return null; // same region and still unreachable — no portal graph can help
  } else {
    // The chain of regions is chosen with the two points in view, not by portal kind alone: a
    // single hop over a bridge at the far end of the island is a cheaper EDGE than two ramps beside
    // the line and a far longer road. `crossingDetour` is in cells and `TUNING.roadCost` is what a
    // cell of road costs, so the two summands are the same currency.
    const hops = routeRegionsMulti(new Set([startRegion]), goalRegion, regionAdj,
      (p) => p.cost + crossingDetour(p.anchor, start, goal) * TUNING.roadCost);
    if (!hops) return null;
    let cur = start;
    let prefix: MacroCoord[] = [];
    for (const hop of hops) {
      const curRegion = a.region[idxAt(cur, W)] ?? startRegion;
      const pair = portals.filter((q) =>
        (q.regionA === hop.regionA && q.regionB === hop.regionB) || (q.regionA === hop.regionB && q.regionB === hop.regionA));
      let best = hop, bestScore = -Infinity, bestIdx = Infinity;
      for (const q of (pair.length ? pair : [hop])) {
        // Scored from where the route has REACHED, not from its first tap: after one hop the trip
        // still to make is `cur → goal`, and a site is on the way or not with respect to that.
        const s = scoreCrossing(world, q, cur, goal).total, qi = idxAt(q.anchor, W);
        if (s > bestScore || (s === bestScore && qi < bestIdx)) { best = q; bestScore = s; bestIdx = qi; }
      }
      const nearSide: 'A' | 'B' = best.regionA === curRegion ? 'A' : 'B';
      const farSide: 'A' | 'B' = nearSide === 'A' ? 'B' : 'A';
      const nearRun = approachRun(best, nearSide), farRun = approachRun(best, farSide);
      const head = nearRun[nearRun.length - 1]!;
      const toDeck = buildLegCells(world, cur, head, blocked, astarCost);
      if (!toDeck) return null;
      let groupCells: MacroCoord[] = [];
      groupCells = appendPath(groupCells, prefix);
      groupCells = appendPath(groupCells, toDeck);
      groupCells = appendPath(groupCells, [...nearRun].reverse());
      groups.push({ cells: groupCells, crossing: best });
      prefix = [...farRun];
      cur = farRun[farRun.length - 1]!;
    }
    const finalCells = buildLegCells(world, cur, goal, blocked, astarCost);
    if (!finalCells) return null;
    let lastGroupCells: MacroCoord[] = [];
    lastGroupCells = appendPath(lastGroupCells, prefix);
    lastGroupCells = appendPath(lastGroupCells, finalCells);
    groups.push({ cells: lastGroupCells });
  }

  const lastGroup = groups[groups.length - 1]!;
  const strict = passableOf(world, false);
  const { cells: squared, pads } = squareJunction(lastGroup.cells, road, strict, W);
  lastGroup.cells = squared;

  const legs: RouteLeg[] = [];
  for (const group of groups) {
    const split = splitLegs(group.cells);
    for (let k = 0; k < split.length; k++) {
      const isLast = k === split.length - 1;
      legs.push(isLast && group.crossing ? { cells: split[k]!, crossing: group.crossing } : { cells: split[k]! });
    }
  }

  let cells: MacroCoord[] = [];
  for (const leg of legs) cells = appendPath(cells, leg.cells);

  let cost = 0;
  for (const leg of legs) {
    for (let k = 1; k < leg.cells.length; k++) cost += road.has(idxAt(leg.cells[k]!, W)) ? TUNING.roadReuseCost : TUNING.roadCost;
    if (leg.crossing) cost += crossingCost(leg.crossing.kind);
  }

  return {
    profile, from, to, legs, cells,
    crossings: legs.filter((l): l is RouteLeg & { crossing: Portal } => !!l.crossing).map((l) => l.crossing),
    pads, blocked: [...blocked].map((i) => ({ x: i % W, y: (i / W) | 0 })), cost,
  };
}
