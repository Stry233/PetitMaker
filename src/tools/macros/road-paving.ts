/**
 * What both road macros (`roads`, `road-link`) do with a set of cells: pave them, join what a
 * crossing's realized deck left short of the pavement, widen the surface, beautify the corners, and
 * guarantee every building the run connected keeps a paved doorstep — plus the two derivations both
 * share, the hub and the nodes a live map implies.
 */
import { ItemCategory, type AutoEdgeCut, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { cellKey, NEIGHBORS4 } from '../../core/model/grid-model';
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { categoryOf, getCatalogItem, isDecoration } from '../../state/catalog';
import { getObjectIndex, objectAt } from '../../state/object-index';
import { objectPlacementCommand, stripCoatingsFor } from '../objects/object-placer';
import { generateObjectId } from '../../core/model/object-id';
import { edgeCutGeneratedRoads, type EdgeCutCtx } from '../edge-cut/auto-edge-cut';
import { centroid, nearestRegionCell } from '../../core/model/geometry';
import { TUNING } from '../placement/tuning';
import type { PlacementAnalysis } from '../placement/analysis';
import { approachCells, astar, crossingExitCells, type Node } from '../placement/network';
import { buildingGate, hasGate, openAt, tryPlace, type PlaceCtx } from '../placement/object';
import { gateTerminalCells } from '../placement/route';
import { objectRect } from '../../state/object-geometry';
import type { MacroContext } from './context';
import { components, networkCells } from './walkable';

/** Lay `roadId` on each cell that can take one, through the rules. A cell the rules refuse is
 *  SKIPPED, never forced: that is how a route necks past a shore the flat trait will not pave. A
 *  cell already carrying a coating is REUSED, not re-placed — the route may legitimately walk over
 *  standing pavement. */
export function paveCells(ctx: MacroContext, place: PlaceCtx, roadId: string, cells: readonly MacroCoord[]): MacroCoord[] {
  const W = ctx.state.template.width;
  const laid: MacroCoord[] = [];
  for (const c of cells) {
    const i = c.y * W + c.x;
    if (place.roads.has(i)) { laid.push(c); continue; }
    if (tryPlace(place, roadId, c.x, c.y)) laid.push(c);
  }
  return laid;
}

/** How far from a tap the route's own end may sit and still count as reaching it: the planner snaps
 *  a tap onto the nearest cell a road can stand on (`nearestWalkable`), which is not always the cell
 *  the hand aimed at. */
const TAP_SLACK = 2;
/** How many times the stitch may try again after a path it paved left a hole. Each retry bans the
 *  cells the rules refused and asks for a way round them, so the bound is on JOGS, not on cells. */
const STITCH_ROUNDS = 4;

/** The cell of `walk` nearest `at` (ties by lowest index), restricted to one piece when `only` is
 *  given, and to `slack` cells of `at` when it is not. */
function nearestWalkCell(
  walk: ReadonlySet<number>, comp: Map<number, number>, at: MacroCoord, W: number,
  { only, slack }: { only?: number; slack?: number },
): number | null {
  let best: number | null = null, bestDist = Infinity;
  for (const i of walk) {
    if (only !== undefined && comp.get(i) !== only) continue;
    const dist = Math.abs((i % W) - at.x) + Math.abs(((i / W) | 0) - at.y);
    if (slack !== undefined && dist > slack) continue;
    if (dist < bestDist || (dist === bestDist && best !== null && i < best)) { best = i; bestDist = dist; }
  }
  return best;
}

/** What a run must be told about the route it just laid. */
export interface RouteJoin {
  /** Null when the pavement joins the two ends. Otherwise the cell where the road toward the far end
   *  stops, so the caller can say where rather than merely that. */
  stoppedAt: MacroCoord | null;
  /** Cells this pass paved, for the beautifier. */
  paved: MacroCoord[];
}

/**
 * A ROUTE IS ONE PIECE, OR IT IS NOT A ROUTE.
 *
 * `route.ts` plans against the crossing SITES a scan found, and a bridge or a ramp does NOT land
 * where its site is: the `waterSpan`/`heightDrop` traits snap the deck during validation, so the
 * realized deck can sit several cells along its own axis from the anchor the plan picked. The plan's
 * approach cells then fall under the deck, or one cell short of its entrance — and one unpaved cell
 * at an entrance severs the route. The deck and its aprons become an island of pavement that neither
 * leg reaches while the run reports success for having laid a hundred tiles: 21% of routes over real
 * generated islands came out exactly that way, in three pieces, every time.
 *
 * So the REALIZED geometry gets the last word rather than the plan. Every deck's own entrances are
 * paved, and then the pavement is stitched — an A* between the pieces, paving as it goes, banning
 * the cells the rules refused so the next round asks for a way round them rather than the same hole
 * again. What still cannot be joined comes back as `stoppedAt`, which is what lets the caller refuse
 * instead of claiming.
 */
export function joinRoute(
  ctx: MacroContext, place: PlaceCtx, roadId: string,
  { a, turnPenalty, crossings, from, to }: {
    a: PlacementAnalysis; turnPenalty: number; crossings: readonly PlacedObject[];
    from: MacroCoord; to: MacroCoord;
  },
): RouteJoin {
  const { state } = ctx;
  const W = a.width, H = a.height;
  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const paved: MacroCoord[] = [];

  // Each realized deck's own entrance, full deck width: a 2-wide ramp has two exit cells per end and
  // an object can hold one while the other stays open.
  for (const obj of crossings) {
    const [exitA, exitB] = crossingExitCells(obj);
    paved.push(...paveCells(ctx, place, roadId, [...exitA, ...exitB].filter((c) => inB(c.x, c.y))));
  }

  const banned = new Set<number>();
  const maxNodes = Math.max(TUNING.networkMaxNodesFloor, W * H);
  let walk = networkCells(state, W, H, { aprons: true }).cells;
  const passable = (x: number, y: number): boolean => {
    if (!inB(x, y)) return false;
    const i = y * W + x;
    if (banned.has(i)) return false;
    return walk.has(i) || a.open[i] === 1;
  };

  for (let round = 0; ; round++) {
    const comp = components(walk, W, H);
    const nearFrom = nearestWalkCell(walk, comp, from, W, { slack: TAP_SLACK });
    const nearTo = nearestWalkCell(walk, comp, to, W, { slack: TAP_SLACK });
    const fromPiece = nearFrom === null ? null : comp.get(nearFrom)!;
    const toPiece = nearTo === null ? null : comp.get(nearTo)!;
    if (fromPiece !== null && fromPiece === toPiece) return { stoppedAt: null, paved };
    if (fromPiece === null || toPiece === null || round >= STITCH_ROUNDS) {
      const stop = fromPiece === null ? null : nearestWalkCell(walk, comp, to, W, { only: fromPiece });
      return { stoppedAt: stop === null ? from : { x: stop % W, y: (stop / W) | 0 }, paved };
    }

    const startIdx = nearestWalkCell(walk, comp, to, W, { only: fromPiece })!;
    const start: MacroCoord = { x: startIdx % W, y: (startIdx / W) | 0 };
    const goals = new Set<number>();
    for (const i of walk) if (comp.get(i) === toPiece) goals.add(i);
    const path = astar(start, goals, passable, W, H, walk, to, maxNodes, turnPenalty);
    if (!path) return { stoppedAt: start, paved };
    const laid = paveCells(ctx, place, roadId, path.filter((c) => inB(c.x, c.y)));
    paved.push(...laid);
    const reached = new Set(laid.map((c) => c.y * W + c.x));
    for (const c of path) { const i = c.y * W + c.x; if (!reached.has(i) && !walk.has(i)) banned.add(i); }
    walk = networkCells(state, W, H, { aprons: true }).cells;
  }
}

/**
 * Grow each freshly laid road into a `width`-sized block of the same surface. Both road macros widen
 * through this one pass, or the bar's size slider means two things.
 *
 * Every added tile goes through the executor, so a tile the rules refuse (water, a footprint, a
 * cliff edge) is skipped and the widening narrows there — a wide road necks down where the ground
 * does. A dilated cell can already carry a coating — another fresh road's own dilation overlapping
 * it, or a road already standing there — and V-PLACE-OVERLAP exempts coatings from the block, so an
 * unguarded place would stack a second road object on top rather than replace the first.
 * `stripCoatingsFor` is the placer's own strip-then-place contract, folded into the caller's own
 * stroke.
 *
 * A DECORATION (tree/flora) is not a coating, so V-PLACE-OVERLAP blocks the tile outright and an
 * unguarded place would just fail there — a hole in the pavement with the plant standing in the
 * middle of a wide street. So a standing planting STOPS the dilation at its cell, whoever put it
 * there, and that cell is counted in the returned narrowed count instead of paved: a wide road necks
 * around a planting exactly as it necks around a shore.
 *
 * NO AUTHORSHIP TEST DECIDES THAT, because on the path a press takes there is nothing to ask. Every
 * macro builds against a detached clone whose executor carries a FRESH provenance ledger
 * (`scratch.ts`), and the worker path hands the builder a bare `GridState`, so a ledger read inside
 * the build knows nothing about anything: sparing "the human-authored ones" meant sparing none, and
 * a width-3 press deleted hand-placed plants. Sweeping only generation's own planting would need an
 * answer this side of the build cannot have, and both callers already refuse to sweep anything a
 * hand may have placed (`sweep`/`clearance: 'refuse'`) — one policy over the whole run rather than
 * two that disagree.
 */
export function widenRoads(ctx: MacroContext, roadId: string, width: number, fresh: readonly PlacedObject[]): number {
  const w = Math.floor(width);
  if (w <= 1 || fresh.length === 0) return 0;
  const { state, executor } = ctx;
  const lo = -Math.floor((w - 1) / 2);
  const hi = Math.ceil((w - 1) / 2);
  // A CELL, not an attempt: two neighbouring dilated tiles both border the same standing planting,
  // and counting each attempt separately would report one narrowed cell as several.
  const blockedCells = new Set<string>();
  for (const road of fresh) {
    for (let dy = lo; dy <= hi; dy++) {
      for (let dx = lo; dx <= hi; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = road.position.x + dx, y = road.position.y + dy;
        const blocker = objectAt(getObjectIndex(state), { x, y });
        if (blocker && isDecoration(blocker)) { blockedCells.add(`${x},${y}`); continue; }
        const obj: PlacedObject = {
          id: generateObjectId(), catalogId: roadId,
          position: { x, y },
          rotation: 0, elevation: road.elevation,
        };
        stripCoatingsFor(executor, state, obj);
        executor.execute(objectPlacementCommand(obj));
      }
    }
  }
  return blockedCells.size;
}

/**
 * The beautifier, on the macro's own cells, INSIDE the macro's stroke: `edgeCutGeneratedRoads` at
 * the live Auto Trim setting's kind. A smart press has always laid square-cornered tiles while every
 * brush stroke beside it got its corners cut, which read as two different road tools. `mode: 'off'`
 * is a no-op, so the setting is honoured rather than overridden.
 */
export function beautifyRoads(ctx: MacroContext, cells: readonly MacroCoord[], mode: AutoEdgeCut): void {
  if (mode === 'off' || cells.length === 0) return;
  const { state, executor } = ctx;
  const edgeCtx: EdgeCutCtx = { gridState: state, executeCommand: (c) => executor.execute(c) };
  edgeCutGeneratedRoads(edgeCtx, [...cells], mode);
}

/** Whether any cell of a building's gate strip already carries a coating — "this door already
 *  meets the network." Reads the LIVE object index rather than a caller-supplied `PlaceCtx.roads`
 *  set: `widenRoads` above lays its dilation through the bare executor, never through `tryPlace`,
 *  so it never touches a `PlaceCtx.roads` Set — a `place.roads`-based check run AFTER a widen can
 *  miss a cell that already has a coating. `state/object-index`'s `roadByCell` is patched by EVERY
 *  command-executor mutation regardless of which path placed it (`bumpObjectsVersion` fires inside
 *  `command-apply.ts`, not inside `tryPlace`), so it is the one answer that cannot be stale. */
export function gateAlreadyPaved(state: GridState, rect: { x: number; y: number; w: number; h: number }, rotation: 0 | 90 | 180 | 270): boolean {
  const { roadByCell } = getObjectIndex(state);
  return gateTerminalCells(rect, rotation).some((c) => roadByCell.has(cellKey(c.x, c.y)));
}

/** How far from a gate the terminal spur looks for the street. The router stops at whatever cell of
 *  its own placeable mask it last reached, and that mask hides the whole ring of margin around every
 *  standing house and every terrace step, so a doorstep the plan named is routinely left three to
 *  eight cells of bare grass away. Past that the pavement in view is some other house's street. */
const SPUR_REACH = 8;

/** Whether the rules will take a road tile here, asked WITHOUT placing one. The router's own
 *  `analysis.open` mask cannot answer this: it excludes an object's dual-grid margin, which is
 *  exactly where a doorstep sits, so a cell the mask calls closed is often a cell a tile stands on
 *  perfectly well. */
function tileFits(ctx: MacroContext, roadId: string, x: number, y: number): boolean {
  const obj: PlacedObject = {
    id: generateObjectId(), catalogId: roadId, position: { x, y }, rotation: 0,
    elevation: surfaceElevation(ctx.state.cells[y]?.[x]?.terrain),
  };
  return ctx.registry.validatePreCommand(objectPlacementCommand(obj), ctx.state).length === 0;
}

/** A street's last few cells to a doorstep: the cells to pave, and where they end up. */
interface DoorSpur {
  /** Bare cells from the standing pavement to `terminal`, in walking order. */
  path: MacroCoord[];
  terminal: MacroCoord;
}

/**
 * THE STREET WALKS THE LAST FEW CELLS TO THE DOOR, and stops at the nearest cell to it that a tile
 * can legally stand on.
 *
 * Two separate things left a doorstep bare, and this answers both. The router plans over
 * `analysis.open`, which excludes every object's dual-grid margin: a gate approach is IN that margin,
 * so the cells between the street and the door read as closed even where the rules would take a tile,
 * and the spur stops wherever the mask runs out. And where the door genuinely opens onto water or over a
 * terrace step, the `flat` trait refuses the whole gate strip, which stops the street wherever the router
 * last looked rather than beside the house.
 *
 * So the walk is done here, over what the RULES allow rather than over the mask: a breadth-first
 * search out of the standing pavement, bounded to `SPUR_REACH` cells around the gate, ending at the
 * cell that ranks nearest the door (a gate-strip cell in the strip's own preference order, else the
 * closest cell to the gate). A door with no pavement in reach is not this pass's to serve.
 */
function planDoorSpur(
  ctx: MacroContext, roadId: string, rect: { x: number; y: number; w: number; h: number },
  rotation: 0 | 90 | 180 | 270,
): DoorSpur | null {
  const state = ctx.state;
  const W = state.template.width, H = state.template.height;
  const { gate } = buildingGate(rect, rotation);
  const strip = gateTerminalCells(rect, rotation);
  const rank = new Map<number, number>();
  strip.forEach((c, k) => { if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) rank.set(c.y * W + c.x, k); });
  const { roadByCell } = getObjectIndex(state);

  const x0 = Math.max(0, gate.x - SPUR_REACH), x1 = Math.min(W - 1, gate.x + SPUR_REACH);
  const y0 = Math.max(0, gate.y - SPUR_REACH), y1 = Math.min(H - 1, gate.y + SPUR_REACH);
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const queue: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!roadByCell.has(cellKey(x, y))) continue;
      dist.set(y * W + x, 0);
      queue.push(y * W + x);
    }
  }
  if (queue.length === 0) return null;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      const ni = ny * W + nx;
      if (dist.has(ni)) continue;
      if (!roadByCell.has(cellKey(nx, ny)) && !tileFits(ctx, roadId, nx, ny)) continue;
      dist.set(ni, dist.get(i)! + 1);
      prev.set(ni, i);
      queue.push(ni);
    }
  }

  // Nearest the door wins: a gate-strip cell in the strip's own order (the approach centre first),
  // then anything else by how close it stands to the gate. Ties go to the shorter walk, then to the
  // lower index, so the choice is the same on every run.
  let best: number | null = null;
  let bestKey: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const [i, d] of dist) {
    const x = i % W, y = (i / W) | 0;
    const r = rank.get(i);
    const near = r ?? strip.length + Math.max(Math.abs(x - gate.x), Math.abs(y - gate.y));
    const key: [number, number, number] = [near, d, i];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = i; bestKey = key;
    }
  }
  if (best === null) return null;
  const path: MacroCoord[] = [];
  for (let i: number | undefined = best; i !== undefined; i = prev.get(i)) {
    if (!roadByCell.has(cellKey(i % W, (i / W) | 0))) path.push({ x: i % W, y: (i / W) | 0 });
  }
  path.reverse();
  return { path, terminal: { x: best % W, y: (best / W) | 0 } };
}

/**
 * GATES ARE THE TERMINALS. A road that serves a house must END at its doorstep, visibly, and where
 * the doorstep itself will take no tile it must end beside it rather than in open grass.
 *
 * The spanning tree links a door to the network and stops there, and three separate mechanisms let
 * that stop short of pavement, all in `network.ts:setupNet`: the gate approach is skipped whenever
 * it is not `open` and the ring search takes the first cell that connects, `pavePath` marks a cell
 * in-network even where the flat trait refused the tile, and `linkToNetwork` paves nothing at all
 * for a start cell already in the network. So the terminal is asserted here rather than
 * hoped for: for every building the run connected, if no cell of its gate strip carries a coating,
 * `planDoorSpur` walks the street the last few cells over ground the RULES allow. The doors that
 * still take none come back, and the caller reports them AT the door.
 *
 * The lone gate-strip attempt after it is the older behaviour, kept for the door with no pavement
 * within `SPUR_REACH`: there is no street to extend there, and a paved doorstep still says which
 * cell the run meant.
 */
export function ensureGateTerminals(
  ctx: MacroContext, place: PlaceCtx, roadId: string, buildings: readonly PlacedObject[],
): { paved: MacroCoord[]; unreached: MacroCoord[] } {
  const paved: MacroCoord[] = [];
  const unreached: MacroCoord[] = [];
  for (const b of buildings) {
    const item = getCatalogItem(b.catalogId);
    if (!item || !hasGate(item)) continue;
    const rect = objectRect(b);
    if (gateAlreadyPaved(ctx.state, rect, b.rotation)) continue;
    const strip = gateTerminalCells(rect, b.rotation);
    const spur = planDoorSpur(ctx, roadId, rect, b.rotation);
    if (spur) {
      paveCells(ctx, place, roadId, spur.path);
      if (gateAlreadyPaved(ctx.state, rect, b.rotation)) { paved.push(spur.terminal); continue; }
    }
    const laid = strip.find((c) => tryPlace(place, roadId, c.x, c.y));
    if (laid) paved.push(laid); else unreached.push(strip[0]!);
  }
  return { paved, unreached };
}

/**
 * The router's hub node: the locked plaza when there is one, else the centroid of the largest open
 * region snapped into that region. Shared by both road macros so they never grow two hub logics.
 *
 * A HUB'S REGION IS THE ONE ITS FOOTPRINT TOUCHES, and it is read off the map rather than guessed.
 * The plaza's own cells are occupied, so they belong to no region and the centre cell answers -1;
 * falling back to the map's LARGEST region is only right where the plaza stands in the middle of it,
 * which is how a generated island comes out and is not how a hand-terraced one does. On a map whose
 * plaza sits in its own walled court, that fallback told `buildNetwork` the network was seeded in a
 * region 7000 cells away: the spanning tree planned every portal chain out of a region the plaza
 * cannot reach, so each realized ramp's approaches A*-ed toward a network on the far side of a cliff,
 * every link failed, and 12 crossings landed joined to nothing while not one road tile was laid.
 */
export function hubNode(state: GridState, analysis: PlacementAnalysis): Node | null {
  const W = analysis.width, H = analysis.height;
  const regionAt = (p: MacroCoord): number => analysis.region[p.y * W + p.x] ?? -1;
  const hubRegion = analysis.rankedRegions[0];
  const plaza = [...state.objects.values()].find((o) => o.locked);
  if (plaza) {
    const r = objectRect(plaza);
    const pos: MacroCoord = { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
    const region = regionAt(pos);
    return { kind: 'hub', pos, region: region >= 0 ? region : (touchedRegion(analysis, r, W, H) ?? hubRegion ?? 0) };
  }
  if (hubRegion === undefined) return null;
  const cells = analysis.regionCells[hubRegion]!;
  return { kind: 'hub', pos: nearestRegionCell(centroid(cells, W), cells, W), region: hubRegion };
}

/** The largest open region on the ring one cell out from `rect`, ties by lowest id. Null where the
 *  footprint is walled in on every side. */
function touchedRegion(
  analysis: PlacementAnalysis, rect: { x: number; y: number; w: number; h: number }, W: number, H: number,
): number | null {
  const x0 = Math.floor(rect.x) - 1, x1 = Math.ceil(rect.x + rect.w);
  const y0 = Math.floor(rect.y) - 1, y1 = Math.ceil(rect.y + rect.h);
  const seen = new Set<number>();
  const take = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const r = analysis.region[y * W + x] ?? -1;
    if (r >= 0) seen.add(r);
  };
  for (let x = x0; x <= x1; x++) { take(x, y0); take(x, y1); }
  for (let y = y0 + 1; y < y1; y++) { take(x0, y); take(x1, y); }
  let best: number | null = null, bestSize = 0;
  for (const r of seen) {
    const size = analysis.regionCells[r]?.length ?? 0;
    if (size > bestSize || (size === bestSize && best !== null && r < best)) { best = r; bestSize = size; }
  }
  return best;
}

/** THE NETWORK IS NOT A DESTINATION: the road surfaces plus the crossings that carry one over water
 *  or a step. These three categories are exactly what a road macro lays, so they are also exactly
 *  what it must not read back as somewhere to go. */
function isNetworkPiece(obj: PlacedObject): boolean {
  const cat = categoryOf(obj);
  return cat === ItemCategory.Road || cat === ItemCategory.Bridge || cat === ItemCategory.Ramp;
}

/** The cells of the ring one step out from a footprint, the band a street can stand in to be "at"
 *  the thing. Off-map entries are included: every caller reads an in-bounds-checked structure. */
export function ringCells(rect: { x: number; y: number; w: number; h: number }): MacroCoord[] {
  const x0 = Math.floor(rect.x) - 1, x1 = Math.ceil(rect.x + rect.w);
  const y0 = Math.floor(rect.y) - 1, y1 = Math.ceil(rect.y + rect.h);
  const cells: MacroCoord[] = [];
  for (let x = x0; x <= x1; x++) { cells.push({ x, y: y0 }); cells.push({ x, y: y1 }); }
  for (let y = y0 + 1; y < y1; y++) { cells.push({ x: x0, y }); cells.push({ x: x1, y }); }
  return cells;
}

/** Whether pavement already touches this object: any cell of the ring one step out from its
 *  footprint carries a coating. "The street is already at the door" for anything with a footprint,
 *  the same reading `gateAlreadyPaved` gives a gate strip. */
function pavementTouches(state: GridState, rect: { x: number; y: number; w: number; h: number }): boolean {
  const { roadByCell } = getObjectIndex(state);
  return ringCells(rect).some((c) => roadByCell.has(cellKey(c.x, c.y)));
}

/** What a live map offers a road run: where to route from, and how much of the map is already done. */
export interface StandingNodes {
  /** The hub, plus one hamlet per standing thing that still wants a road. */
  nodes: Node[];
  /** How many things the network ALREADY meets, and so have no node. The one honest source for
   *  "every building here already meets the network": a run with no hamlets left and some of these
   *  is a finished map, not a map with nothing on it. */
  served: number;
}

/**
 * THE NODES A LIVE MAP IMPLIES: the hub, plus one hamlet per standing thing the network should
 * SERVE, anchored on the cell a road would MEET it at (the gate approach for a house, else the
 * nearest routable ring cell) rather than its own centre — a footprint cell is occupied, so it is
 * open in no region and the node would be dropped. A `Node` is a plain `{kind, pos, region}` struct,
 * so filling it from existing objects duplicates no settlement logic and re-runs no settlement stage.
 *
 * The excluded four are the plaza (locked, and the hub already stands for it), decorations, the
 * network itself, and anything the network already touches. Those last two are the whole reason this
 * derivation is here rather than inline in the caller, and both are the same mistake: reading a
 * finished map as a list of errands.
 *
 * A press lays a few hundred road tiles, so a node list that reads them back as doorsteps gives the
 * NEXT press a few hundred destinations, and it plans crossings between the regions they imply. And
 * an anchor is the first OPEN ring cell, so once a street runs beside a house the near ring is paved
 * (paved is occupied, and occupied is not open) and the anchor jumps to whatever open cell is next —
 * a plateau over the fence, in another region, which the spanning tree then bridges to in order to
 * reach a house the street is already at. Four presses on one island grew five ramps into thirty-six,
 * most of them in bare grass with no pavement within reach, and `changes` never fell to zero so the
 * honest "this is already the plan" report could not fire. Anything that asks a live map for its
 * nodes asks here.
 */
export function standingNodes(state: GridState, analysis: PlacementAnalysis): StandingNodes {
  const W = analysis.width, H = analysis.height;
  const regionAt = (p: MacroCoord): number => analysis.region[p.y * W + p.x] ?? -1;
  const nodes: Node[] = [];
  const hub = hubNode(state, analysis);
  if (hub) nodes.push(hub);
  // `analysis.open` already excludes every object footprint, so the ring search's separate occupancy
  // set has nothing left to add.
  const noOccupancy = new Set<number>();
  let served = 0;
  for (const obj of state.objects.values()) {
    if (obj.locked || isDecoration(obj) || isNetworkPiece(obj)) continue;
    const rect = objectRect(obj);
    if (pavementTouches(state, rect)) { served += 1; continue; }
    const item = getCatalogItem(obj.catalogId);
    const gate = item && hasGate(item) ? buildingGate(rect, obj.rotation).approach : null;
    const anchor = [...(gate ? [gate] : []), ...approachCells(rect, analysis, W, H, noOccupancy)]
      .find((c) => openAt(analysis, c.x, c.y));
    if (!anchor) continue;
    nodes.push({ kind: 'hamlet', pos: anchor, region: regionAt(anchor) });
  }
  return { nodes, served };
}
