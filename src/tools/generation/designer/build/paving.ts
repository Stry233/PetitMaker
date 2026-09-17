/**
 * THE COURSES THAT JOIN SOMETHING TO THE STREETS.
 *
 * Stage B lays the streets; this is what everything else reaches them by — a doorstep, the plaza's
 * own ring, a bridge's bank, the frame around the set piece. All of them take the same course, and
 * `connector` is it: a breadth-first search in 2x2 stamps over pavable ground at ONE terrace level,
 * so a way to the network cannot pinch to a single cell, cannot end in a tip, and cannot walk up a
 * step the walk has no ramp for.
 *
 * Pavement is placed through `tryPlace` like everything else the pipeline puts down, so the rules
 * judge each cell and a refusal changes nothing.
 */
import { distanceField, flatIndex } from '../../../../core/model/grid-model';
import { ItemCategory, type GridState, type MacroCoord } from '../../../../core/model/types';
import { categoryOf } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import { entriesNear, getObjectIndex } from '../../../../state/object-index';
import { tryPlace, type PlaceCtx } from '../../../placement/object';
import type { AnchorLane } from '../places/anchors';
import type { Scope } from './scope';

/** How far a course may run by default: the reach a bridge's bare bank is given to find the
 *  pavement it joins the network at. */
export const BRIDGE_REACH = 12;

/** How far the plaza's apron course may run to find the streets. */
const PLAZA_REACH = 40;

/**
 * The way from a bridge's bank to the nearest street: a two-wide course of pavement, or null where
 * the streets are out of reach.
 *
 * It is a search rather than a straight run because the town between the channel and the streets is
 * terraced, and a course that walks into a terrace is no way at all. It is TWO WIDE for the same
 * reason every other road here is: the courses are laid as 2x2 stamps whose every cell is pavable,
 * so a connector cannot pinch to one cell and cannot end in a tip.
 *
 * The bank itself is often unpavable, and that is the dual grid rather than a defect: a coating
 * validates one column right and one row bottom of itself, so the cell immediately north or west of
 * water can never be paved. The course starts at the first cell that can be, and the deck's own
 * footprint carries the last step.
 */
export function connector(
  place: PlaceCtx, pavable: Uint8Array, surface: Int8Array, at: MacroCoord, dx: number, dy: number,
  reach = BRIDGE_REACH,
): MacroCoord[] | null {
  const W = place.state.template.width, H = place.state.template.height;
  // A COURSE STAYS ON ONE TERRACE. Pavement may be laid at any level now, so a search that only
  // asked for pavable ground would walk up a terrace step and leave two stretches of street with no
  // ramp between them: paved, legal, and not a way to anywhere.
  const level = surface[flatIndex(at.x, at.y, W)]!;
  const index = getObjectIndex(place.state);
  /** Whether anything a coating may not go over stands on the cell: a deck, a ramp, a building.
   *  Roads are coatings and are what the course is looking for, so they do not block it. The rect is
   *  read as the CELLS it covers, since a bridge or a ramp anchors on the half grid. Memoized per
   *  cell for this search's life: neighbouring 2x2 stamps share three cells each, so the BFS asks
   *  the index the same question several times over. */
  const solidCache = new Uint8Array(W * H);
  const solid = (x: number, y: number): boolean => {
    const i = flatIndex(x, y, W);
    const known = solidCache[i]!;
    if (known !== 0) return known === 1;
    const hit = entriesNear(index, { x, y, w: 1, h: 1 }).some((e) => !e.coating
      && Math.floor(e.rect.x) <= x && x < Math.ceil(e.rect.x + e.rect.w)
      && Math.floor(e.rect.y) <= y && y < Math.ceil(e.rect.y + e.rect.h));
    solidCache[i] = hit ? 1 : 2;
    return hit;
  };
  const stampFree = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x + 1 < W && y + 1 < H
    && !!pavable[flatIndex(x, y, W)] && !!pavable[flatIndex(x + 1, y, W)]
    && !!pavable[flatIndex(x, y + 1, W)] && !!pavable[flatIndex(x + 1, y + 1, W)]
    && surface[flatIndex(x, y, W)] === level
    && !solid(x, y) && !solid(x + 1, y) && !solid(x, y + 1) && !solid(x + 1, y + 1);
  const stampPaved = (x: number, y: number): boolean =>
    place.roads.has(flatIndex(x, y, W)) || place.roads.has(flatIndex(x + 1, y, W))
    || place.roads.has(flatIndex(x, y + 1, W)) || place.roads.has(flatIndex(x + 1, y + 1, W));

  // The first anchor off the bank whose whole stamp can be paved.
  const starts: MacroCoord[] = [];
  for (let k = 0; k <= 2 && starts.length === 0; k++) {
    const cx = at.x + dx * k, cy = at.y + dy * k;
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
      if (stampFree(cx + ox, cy + oy)) starts.push({ x: cx + ox, y: cy + oy });
    }
  }
  if (!starts.length) return null;

  const seen = new Uint8Array(W * H);
  const from = new Int32Array(W * H).fill(-1);
  const queue: number[] = [];
  const depth = new Int16Array(W * H);
  for (const s of starts) {
    const i = flatIndex(s.x, s.y, W);
    if (seen[i]) continue;
    seen[i] = 1;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const x = cur % W, y = (cur / W) | 0;
    if (stampPaved(x, y)) return course(place, from, cur, W);
    if (depth[cur]! >= reach) continue;
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + ddx, ny = y + ddy;
      if (!stampFree(nx, ny)) continue;
      const ni = flatIndex(nx, ny, W);
      if (seen[ni]) continue;
      seen[ni] = 1;
      from[ni] = cur;
      depth[ni] = depth[cur]! + 1;
      queue.push(ni);
    }
  }
  return null;
}

/** The cells a found course needs paved: every cell of every 2x2 stamp along it, each named once.
 *  Consecutive stamps overlap by half, and the last one reaches the street the course was routed to,
 *  so without this the caller would ask the rules to coat the same cell three and four times over
 *  and read the refusals as failures. */
export function course(place: PlaceCtx, from: Int32Array, end: number, W: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  const seen = new Set<number>();
  for (let i = end; i >= 0; i = from[i]!) {
    const x = i % W, y = (i / W) | 0;
    for (const c of [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }]) {
      const k = flatIndex(c.x, c.y, W);
      if (seen.has(k) || place.roads.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/**
 * The plaza joined to the streets, where nothing was laid against it.
 *
 * The ring read here is the plaza OBJECT's own covered cells, dilated by one cell on the four sides
 * — the same 4-adjacency the connectivity ledger walks. A street touching the plaza only at a corner
 * is not a way in: the dual grid leaves the column west and the row north of a raised thing
 * unpavable, so a plan can come back with pavement one diagonal step from the hub and no route to
 * it at all. Where that happens, the same 2-wide course a doorstep takes joins the two.
 */
export function pavePlazaApron(
  place: PlaceCtx, pavable: Uint8Array, surface: Int8Array, material: string, scope: Scope,
): number {
  const { state } = place;
  const W = state.template.width, H = state.template.height;
  const plaza = [...state.objects.values()].find((o) => o.locked);
  if (!plaza) return 0;
  const r = objectRect(plaza);
  const x0 = Math.floor(r.x), x1 = Math.ceil(r.x + r.w) - 1;
  const y0 = Math.floor(r.y), y1 = Math.ceil(r.y + r.h) - 1;
  const ring: MacroCoord[] = [];
  for (let x = x0; x <= x1; x++) ring.push({ x, y: y0 - 1 }, { x, y: y1 + 1 });
  for (let y = y0; y <= y1; y++) ring.push({ x: x0 - 1, y }, { x: x1 + 1, y });
  const inside = ring.filter((c) => c.x >= 0 && c.y >= 0 && c.x < W && c.y < H);
  if (inside.some((c) => place.roads.has(flatIndex(c.x, c.y, W)))) return 0;
  for (const c of inside) {
    if (!pavable[flatIndex(c.x, c.y, W)]) continue;
    // A LONGER REACH THAN A DOORSTEP'S, because this is the hub: the nearest street can be most of
    // a block away when the plaza's own ring is the only ground left at its level.
    const laid = paveApproach(place, pavable, surface, material, c, scope, PLAZA_REACH);
    if (laid > 0) return laid;
  }
  return 0;
}

/**
 * The doorstep joined to the streets: a 2-wide course from the approach cell to the nearest
 * pavement on its own terrace, plus the approach itself.
 *
 * The course is the same one a bridge's bank takes, for the same reason — it is laid in 2x2 stamps,
 * so it cannot pinch to one cell and cannot end in a tip. Where no course exists the approach is
 * left alone rather than paved into a pocket: `unroadedGates` then reports the door, which is a
 * finding a caller can fail on.
 */
export function paveApproach(
  place: PlaceCtx, pavable: Uint8Array, surface: Int8Array, material: string,
  approach: MacroCoord, scope: Scope, reach = BRIDGE_REACH,
): number {
  let laid = 0;
  let joined = false;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    const course = connector(place, pavable, surface, approach, dx, dy, reach);
    if (!course) continue;
    for (const c of course) {
      if (!scope.cell(c.x, c.y)) continue;
      if (tryPlace(place, material, c.x, c.y)) laid++;
    }
    joined = true;
    break;
  }
  const W = place.state.template.width;
  // THE DOORSTEP IS ONLY PAVED WHERE IT JOINS SOMETHING. A cell laid on its own where no course
  // reached the network is a paved pocket: the connectivity ledger counts it as pavement the plaza
  // cannot walk to and as a tip cell at once, and it does the door no good either, since a walker
  // cannot get to it. Where the approach already stands against pavement it is the last cell of a
  // street rather than a pocket, and it is laid.
  if (!joined && !touches(place.roads, approach, W, place.state.template.height)) return laid;
  if (scope.cell(approach.x, approach.y) && !place.roads.has(flatIndex(approach.x, approach.y, W))
    && tryPlace(place, material, approach.x, approach.y)) laid++;
  return laid;
}

/**
 * A BORDER LAID ROUND A SET PIECE, and only where the plaza can walk to it.
 *
 * The figure's calm band and a fountain court's own dry margin are the same job: a band of ground
 * reserved around something composed, which reads as a FRAME when it is paved and as an empty field
 * when it is not: `framed` counts a band paved OR bare, and a bare one frames nothing.
 *
 * IT IS PAVED ONLY WHERE IT CAN JOIN THE NETWORK. A ring nothing reaches is a paved pocket, which the
 * hard ledger reads as unreachable pavement and a visitor reads as scenery. ONE CONNECTED PIECE OF IT
 * at a time, never the whole band: a cell the terrain or a lot took cuts the band into arcs, and an
 * arc no course reaches is pavement the plaza cannot walk to — tip cells at both its ends. So the
 * arcs are found first and only the ones the network joins are paved.
 *
 * THE COURSE IS FOUND BEFORE ANYTHING IS LAID, and it is tried from the few cells nearest the network
 * rather than from every cell of an arc: `connector` asks the object index about each stamp it steps
 * on, so running it from a hundred cells in five directions is most of a map's build time on the
 * seeds where the answer is no.
 */
export function paveBand(
  place: PlaceCtx, pavable: Uint8Array, surface: Int8Array, material: string,
  band: readonly MacroCoord[], scope: Scope, reach: number, arcMin: number,
): number {
  if (band.length === 0) return 0;
  const state = place.state;
  const W = state.template.width, H = state.template.height;
  const network = pavedFromPlaza(place);
  const toNetwork = distanceField([...network], W, H, true);
  const near = (c: MacroCoord): number => toNetwork[flatIndex(c.x, c.y, W)]!;
  let laid = 0;
  for (const arc of arcsOf(band, W)) {
    if (arc.length < arcMin) continue;
    const joined = arc.some((c) => touches(network, c, W, H));
    let path: MacroCoord[] | null = null;
    const tries = joined ? [] : [...arc].sort((a, b) => near(a) - near(b)).slice(0, BAND_TRIES);
    for (const c of tries) {
      if (path || near(c) > reach) break;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        path = connector(place, pavable, surface, c, dx, dy, reach);
        if (path) break;
      }
    }
    if (!joined && !(path && path.some((c) => touches(network, c, W, H)))) continue;
    for (const c of [...(path ?? []), ...arc]) {
      if (!scope.cell(c.x, c.y) || place.roads.has(flatIndex(c.x, c.y, W))) continue;
      if (tryPlace(place, material, c.x, c.y)) laid++;
    }
  }
  return laid;
}

/** How many cells of one arc a course is tried from, nearest the network first. */
const BAND_TRIES = 4;

/** The 4-connected pieces of a set of cells, largest first. */
export function arcsOf(cells: readonly MacroCoord[], W: number): MacroCoord[][] {
  const own = new Map(cells.map((c) => [flatIndex(c.x, c.y, W), c] as const));
  const seen = new Set<number>();
  const out: MacroCoord[][] = [];
  for (const [start, at] of own) {
    if (seen.has(start)) continue;
    const piece: MacroCoord[] = [];
    const stack = [{ i: start, c: at }];
    seen.add(start);
    while (stack.length) {
      const { c } = stack.pop()!;
      piece.push(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = flatIndex(c.x + dx, c.y + dy, W);
        const next = own.get(j);
        if (!next || seen.has(j)) continue;
        seen.add(j);
        stack.push({ i: j, c: next });
      }
    }
    out.push(piece);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * The pavement the PLAZA can walk to, as flat indices.
 *
 * The same conductance the evaluator's own connectivity reading uses: pavement and the plaza conduct,
 * and a crossing's footprint conducts to its whole 3x3 so a deck or a ramp joins the two levels it
 * spans. Anything that wants to lay pavement of its own has to reach THIS set, since pavement joined to
 * a stub the plaza cannot reach is unreachable pavement however connected it looks locally.
 */
export function pavedFromPlaza(place: PlaceCtx): Set<number> {
  const state = place.state;
  const W = state.template.width, H = state.template.height;
  const conduct = new Set<number>(place.roads);
  const seeds: number[] = [];
  for (const o of state.objects.values()) {
    const cat = categoryOf(o);
    const r = objectRect(o);
    const crossing = cat === ItemCategory.Bridge || cat === ItemCategory.Ramp;
    if (!o.locked && !crossing) continue;
    for (let y = Math.floor(r.y) - (crossing ? 1 : 0); y < Math.ceil(r.y + r.h) + (crossing ? 1 : 0); y++) {
      for (let x = Math.floor(r.x) - (crossing ? 1 : 0); x < Math.ceil(r.x + r.w) + (crossing ? 1 : 0); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = flatIndex(x, y, W);
        conduct.add(i);
        if (o.locked) seeds.push(i);
      }
    }
  }
  const seen = new Set<number>();
  const stack = seeds.filter((i) => conduct.has(i));
  for (const i of stack) seen.add(i);
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % W, y = (p / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = flatIndex(nx, ny, W);
      if (seen.has(j) || !conduct.has(j)) continue;
      seen.add(j);
      stack.push(j);
    }
  }
  return seen;
}

/** Whether a cell stands in `set` or orthogonally beside it. */
export function touches(set: ReadonlySet<number>, c: MacroCoord, W: number, H: number): boolean {
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = c.x + dx, ny = c.y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    if (set.has(flatIndex(nx, ny, W))) return true;
  }
  return false;
}

/** Whether a lane's mouth touches pavement already laid — the lane's own cells excluded, since a
 *  lane joins the network at the frontage or not at all. */
export function mouthPaved(paved: ReadonlySet<number>, state: GridState, lane: AnchorLane): boolean {
  const W = state.template.width, H = state.template.height;
  const own = new Set(lane.cells.map((c) => flatIndex(c.x, c.y, W)));
  for (const c of lane.mouth) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = flatIndex(x, y, W);
      if (paved.has(i) && !own.has(i)) return true;
    }
  }
  return false;
}
