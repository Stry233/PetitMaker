/**
 * What both road macros (`roads`, `road-link`) do with a set of cells: pave them, join what a
 * crossing's realized deck left short of the pavement, widen the surface, beautify the corners, and
 * guarantee every building the run connected keeps a paved doorstep — plus the two derivations both
 * share, the hub and the nodes a live map implies.
 */
import { placeObjectCommand } from '../../../core/model/command-build';
import { type GridState, type MacroCoord, type PlacedObject, type Rotation } from '../../../core/model/types';
import { type AutoEdgeCut } from '../../../state/editing/vocabulary';
import { templateLandmark } from '../../../core/model/landmarks';
import { cellKey, mapGrid } from '../../../core/grid/rect';
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { terrainCellsUnder } from '../../../core/grid/footprint';
import { getCatalogItem, isDecoration } from '../../../state/catalog';
import { getObjectIndex, objectAt } from '../../../state/object-index';
import { stripCoatingsFor } from '../../placement/coatings';
import { generateObjectId } from '../../../core/model/object-id';
import { edgeCutGeneratedRoads } from '../../trim/auto-edge-cut';
import { commandSink } from '../../../core/commands/edit-context';
import { centroid, nearestRegionCell, components } from '../../../core/grid/cell-sets';
import { TUNING } from './tuning';
import type { PlacementAnalysis } from '../../placement/analysis';
import { approachCells, astar, crossingExitCells, type Node } from './network';
import { buildingGate, openAt, probePlacement, tryPlace, type PlaceCtx } from '../../placement/object';
import { gateTerminalCells } from './route';
import { hasGate, crossingRunsAlongX, objectRect } from '../../../state/object-geometry';
import type { MacroContext } from '../context';
import { networkCells } from './walkable';
import { isCoatingItem, isCrossing } from '../../../core/model/traits';

/** Lay `roadId` on each cell that can take one, through the rules. A cell the rules refuse is
 *  Skipped, never forced: that is how a route necks past a shore the flat trait will not pave. A
 *  cell already carrying a coating is reused, not re-placed — the route may legitimately walk over
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
 *  cells the rules refused and asks for a way round them, so the bound is on jogs, not on cells. */
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
interface RouteJoin {
  /** Null when the pavement joins the two ends. Otherwise the cell where the road toward the far end
   *  stops, so the caller can say where rather than merely that. */
  stoppedAt: MacroCoord | null;
  /** Cells this pass paved, for the beautifier. */
  paved: MacroCoord[];
}

/**
 * A route is one piece, or it is not a route. `route.ts` plans against crossing sites, but the
 * `waterSpan`/`heightDrop` traits snap a deck as the command resolves, possibly several cells along its
 * axis, so one unpaved cell at an entrance leaves the deck a detached piece. The realized geometry
 * gets the last word: every deck's entrances are paved, then an A* stitches the pieces, banning
 * cells the rules refused so the next round goes round them. What cannot be joined comes back as
 * `stoppedAt`, so the caller can refuse.
 */
export function joinRoute(
  ctx: MacroContext, place: PlaceCtx, roadId: string,
  { a, turnPenalty, crossings, from, to, width = 1 }: {
    a: PlacementAnalysis; turnPenalty: number; crossings: readonly PlacedObject[];
    from: MacroCoord; to: MacroCoord;
    width?: number;
  },
): RouteJoin {
  const { state } = ctx;
  const W = a.width, H = a.height;
  const { inB } = mapGrid(W, H);
  const paved: MacroCoord[] = [];

  // Half-grid decks can overlap an extra row. Keep the apron aligned with the chosen road width,
  // using another lane only when its preferred entrance is blocked.
  for (const obj of crossings) {
    const [exitA, exitB] = crossingExitCells(obj);
    const r = objectRect(obj), horizontal = crossingRunsAlongX(obj);
    const center = Math.floor(horizontal ? r.y + (r.h - 1) / 2 : r.x + (r.w - 1) / 2);
    const low = center - Math.floor((width - 1) / 2), high = center + Math.ceil((width - 1) / 2);
    for (const exit of [exitA, exitB]) {
      const available = exit.filter(c => inB(c.x, c.y));
      const aligned = available.filter(c => (horizontal ? c.y : c.x) >= low && (horizontal ? c.y : c.x) <= high);
      const laid = paveCells(ctx, place, roadId, aligned);
      paved.push(...(laid.length ? laid : paveCells(ctx, place, roadId, available)));
    }
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
    const path = astar(start, goals, { passable, W, H, road: walk, center: to, maxNodes, turnPenalty });
    if (!path) return { stoppedAt: start, paved };
    const laid = paveCells(ctx, place, roadId, path.filter((c) => inB(c.x, c.y)));
    paved.push(...laid);
    const reached = new Set(laid.map((c) => c.y * W + c.x));
    for (const c of path) { const i = c.y * W + c.x; if (!reached.has(i) && !walk.has(i)) banned.add(i); }
    walk = networkCells(state, W, H, { aprons: true }).cells;
  }
}

/**
 * Widens freshly laid roads through the rule-aware executor. Existing coatings are replaced rather
 * than stacked. Invalid ground and any standing decoration stop dilation at that cell, narrowing the
 * result without deleting objects whose authorship is unavailable on detached build state.
 */
export function widenRoads(ctx: MacroContext, roadId: string, width: number, fresh: readonly PlacedObject[]): number {
  const w = Math.floor(width);
  if (w <= 1 || fresh.length === 0) return 0;
  const { state, executor } = ctx;
  const lo = -Math.floor((w - 1) / 2);
  const hi = Math.ceil((w - 1) / 2);
  // A cell, not an attempt: two neighbouring dilated tiles both border the same standing planting,
  // and counting each attempt separately would report one narrowed cell as several.
  const blockedCells = new Set<string>();
  for (const road of fresh) {
    for (let dy = lo; dy <= hi; dy++) {
      for (let dx = lo; dx <= hi; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = road.position.x + dx, y = road.position.y + dy;
        const blocker = objectAt(getObjectIndex(state), { x, y });
        if (blocker && isDecoration(blocker)) { blockedCells.add(cellKey(x, y)); continue; }
        const obj: PlacedObject = {
          id: generateObjectId(), catalogId: roadId,
          position: { x, y },
          rotation: 0, elevation: road.elevation,
        };
        stripCoatingsFor(executor, state, obj);
        executor.execute(placeObjectCommand(obj));
      }
    }
  }
  return blockedCells.size;
}

/**
 * The beautifier, on the macro's own cells, inside the macro's stroke: `edgeCutGeneratedRoads` at
 * the live Auto Trim setting's kind, so a smart press cuts its corners as a brush stroke does.
 * `mode: 'off'` is a no-op, so the setting is honoured rather than overridden.
 */
export function beautifyRoads(ctx: MacroContext, cells: readonly MacroCoord[], mode: AutoEdgeCut): void {
  if (mode === 'off' || cells.length === 0) return;
  edgeCutGeneratedRoads(commandSink(ctx), [...cells], mode);
}

/** Whether any cell of a building's gate strip already carries a coating — "this door already
 *  meets the network." Reads the live object index rather than a caller-supplied `PlaceCtx.roads`
 *  set: `widenRoads` above lays its dilation through the bare executor, never through `tryPlace`,
 *  so it never touches a `PlaceCtx.roads` Set — a `place.roads`-based check run after a widen can
 *  miss a cell that already has a coating. `state/object-index`'s `roadByCell` is patched by every
 *  command-executor mutation regardless of which path placed it (`bumpObjectsVersion` fires inside
 *  `command-apply.ts`, not inside `tryPlace`), so it is the one answer that cannot be stale. */
export function gateAlreadyPaved(state: GridState, rect: { x: number; y: number; w: number; h: number }, rotation: Rotation): boolean {
  const { roadByCell } = getObjectIndex(state);
  return gateTerminalCells(rect, rotation).some((c) => roadByCell.has(cellKey(c.x, c.y)) && exposedPavement(state, c.x, c.y));
}

/** Paving beneath a building is legal but cannot connect a pedestrian route. */
function exposedPavement(state: GridState, x: number, y: number): boolean {
  const object = objectAt(getObjectIndex(state), { x, y });
  return !object || isCoatingItem(getCatalogItem(object.catalogId));
}

/** How far from a gate the terminal spur looks for the street. The router stops at whatever cell of
 *  its own placeable mask it last reached, and that mask hides the whole ring of margin around every
 *  standing house and every terrace step, so a doorstep the plan named is routinely left three to
 *  eight cells of bare grass away. Past that the pavement in view is some other house's street. */
const SPUR_REACH = 8;

/** Whether the rules will take a road tile here, asked without placing one. The router's own
 *  `analysis.open` mask cannot answer this: it excludes an object's dual-grid margin, which is
 *  exactly where a doorstep sits, so a cell the mask calls closed is often a cell a tile stands on
 *  perfectly well. */
function tileFits(ctx: MacroContext, roadId: string, x: number, y: number): boolean {
  return exposedPavement(ctx.state, x, y) && probePlacement(ctx, roadId, x, y) !== null;
}

/** A street's last few cells to a doorstep: the cells to pave, and where they end up. */
interface DoorSpur {
  /** Bare cells from the standing pavement to `terminal`, in walking order. */
  path: MacroCoord[];
  terminal: MacroCoord;
}

/**
 * The street walks the last few cells to the door and stops at the nearest cell a tile can legally
 * stand on. The router plans over `analysis.open`, which excludes every object's dual-grid margin
 * where a gate approach lies, and the `flat` trait refuses a whole gate strip over water or a step.
 * So this searches breadth-first over what the rules allow, out of the standing pavement within
 * `SPUR_REACH` of the gate, ending at the cell ranked nearest the door. A door with no pavement in
 * reach is not served here.
 */
function planDoorSpur(
  ctx: MacroContext, roadId: string, rect: { x: number; y: number; w: number; h: number },
  rotation: Rotation,
): DoorSpur | null {
  const state = ctx.state;
  const W = state.template.width, H = state.template.height;
  const { gate } = buildingGate(rect, rotation);
  const strip = gateTerminalCells(rect, rotation);
  const rank = new Map<number, number>();
  const { inB, idx } = mapGrid(W, H);
  strip.forEach((c, k) => { if (inB(c.x, c.y)) rank.set(idx(c.x, c.y), k); });
  const { roadByCell } = getObjectIndex(state);

  const x0 = Math.max(0, gate.x - SPUR_REACH), x1 = Math.min(W - 1, gate.x + SPUR_REACH);
  const y0 = Math.max(0, gate.y - SPUR_REACH), y1 = Math.min(H - 1, gate.y + SPUR_REACH);
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const queue: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!roadByCell.has(cellKey(x, y)) || !exposedPavement(state, x, y)) continue;
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
      if (!exposedPavement(state, nx, ny)) continue;
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
 * Gates are the terminals: a road serving a house ends visibly at its doorstep, or beside it where
 * the doorstep takes no tile. `setupNet` can stop short of pavement three ways (a closed approach
 * falls to the ring search, `pavePath` marks refused cells in-network, `linkToNetwork` paves nothing
 * from a cell already in it), so for every connected building with no coating in its gate strip
 * `planDoorSpur` walks the street the last cells. Doors still bare come back for the caller to
 * report at the door. The lone gate-strip attempt after it serves a door with no pavement within
 * `SPUR_REACH`.
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
    const laid = strip.find((c) => tileFits(ctx, roadId, c.x, c.y) && tryPlace(place, roadId, c.x, c.y));
    if (laid) paved.push(laid); else unreached.push(strip[0]!);
  }
  return { paved, unreached };
}

/**
 * The router's hub node: the locked landmark when there is one, else the centroid of the largest open
 * region snapped into that region. Shared by both road macros so they never grow two hub logics.
 *
 * A hub's region is the one its footprint touches, and it is read off the map rather than guessed.
 * The landmark's own cells are occupied, so they belong to no region and the centre cell answers -1;
 * falling back to the map's largest region is only right where the landmark stands in the middle of it,
 * which is how a generated planet comes out and is not how a hand-terraced one does. Where the landmark
 * sits in its own walled court, that fallback seeds `connectRoadNetwork` in a region the landmark cannot reach,
 * and every link from it fails.
 */
function hubNode(state: GridState, analysis: PlacementAnalysis): Node | null {
  const W = analysis.width, H = analysis.height;
  const regionAt = (p: MacroCoord): number => analysis.region[p.y * W + p.x] ?? -1;
  const hubRegion = analysis.rankedRegions[0];
  const hub = hubObject(state);
  if (hub) {
    const r = objectRect(hub);
    const pos: MacroCoord = { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
    const region = regionAt(pos);
    return { kind: 'hub', pos, region: region >= 0 ? region : (touchedRegion(analysis, r, W, H) ?? hubRegion ?? 0) };
  }
  if (hubRegion === undefined) return null;
  const cells = analysis.regionCells[hubRegion]!;
  return { kind: 'hub', pos: nearestRegionCell(centroid(cells, W), cells, W), region: hubRegion };
}

/** The locked landmark a road network is rooted at, when the map has one. */
function hubObject(state: GridState): PlacedObject | undefined {
  const landmark = templateLandmark(state);
  return landmark?.locked ? landmark : undefined;
}

/**
 * A hub no open region reaches becomes a region of its own, on the tier of its ground. `setupNet`
 * seeds the network on the hub's footprint, so where the hub sits on a plate no larger than itself
 * one tier up, its ring is all cliff margin and no walk joins it. Registering the footprint as a
 * region lets `scanPortals` offer the ramps onto it, and the tree rooted at the hub builds one first.
 * The cells stay closed in `open`. Call before `scanPortals`; a reachable hub keeps its region.
 */
export function claimHubRegion(state: GridState, analysis: PlacementAnalysis): void {
  const hub = hubObject(state);
  if (!hub) return;
  const W = analysis.width, H = analysis.height;
  const r = objectRect(hub);
  if (touchedRegion(analysis, r, W, H) !== null) return;
  const cells: number[] = [];
  for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(H, r.y + r.h); y++) {
    for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(W, r.x + r.w); x++) {
      if (analysis.region[y * W + x] === -1) cells.push(y * W + x);
    }
  }
  if (cells.length === 0) return;
  const { inB, idx } = mapGrid(W, H);
  let tier = Infinity;
  for (const c of terrainCellsUnder(r)) {
    if (inB(c.x, c.y)) tier = Math.min(tier, analysis.elev[idx(c.x, c.y)]!);
  }
  const id = analysis.regionCells.length;
  for (const i of cells) analysis.region[i] = id;
  analysis.regionCells.push(cells);
  analysis.regionElev.push(Number.isFinite(tier) ? tier : 0);
  analysis.rankedRegions.splice(0, analysis.rankedRegions.length,
    ...analysis.regionCells.map((_, k) => k).sort((a, b) => analysis.regionCells[b]!.length - analysis.regionCells[a]!.length));
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

/** The network is not a destination: the road surfaces plus the crossings that carry one over water
 *  or a step. These pieces are exactly what a road macro lays, so they are also exactly
 *  what it must not read back as somewhere to go. */
function isNetworkPiece(obj: PlacedObject): boolean {
  const item = getCatalogItem(obj.catalogId);
  return isCoatingItem(item) || isCrossing(item);
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
interface StandingNodes {
  /** The hub, plus one hamlet per standing thing that still wants a road. */
  nodes: Node[];
  /** How many things the network already meets, and so have no node. The one honest source for
   *  "every building here already meets the network": a run with no hamlets left and some of these
   *  is a finished map, not a map with nothing on it. */
  served: number;
}

/**
 * Derives routing nodes from a live map: the hub plus one unserved, non-decoration object. Buildings
 * use their gate approach; other objects use the nearest open footprint-ring cell. Locked landmark
 * objects, network pieces, decorations, and objects already touching pavement are excluded.
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
