import { IndexHeap } from '../../../core/base/heap';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { rectContains, mapGrid, type MapGrid } from '../../../core/grid/rect';
import { TUNING } from './tuning';
import { hasGate, crossingRunsAlongX, objectRect } from '../../../state/object-geometry';
import { tryPlace, removePlaced, forEachFootprintCell, buildingGate, type PlaceCtx } from '../../placement/object';
import { getPlaceableWhere, getCatalogItem, isDecoration } from '../../../state/catalog';
import type { PlacementAnalysis } from '../../placement/analysis';
import { regionPairKey, routeRegionsMulti, type Portal } from './portals';
import { turnPenaltyFor } from './road-style';
import { crossingEndClearance, crossingEnds, mainCrossingId } from '../../placement/crossings';
import { makeNetworkVariation, orderTail, VARY, type NetworkVariation } from './network-variation';
import { isCoating, isCrossing } from '../../../core/model/traits';

/** Everything a road should reach: every placed object except the vegetation. Buildings and
 *  facilities want a door spur, and a road/bridge/ramp is already part of the network it links
 *  into, so the one thing to leave out is decoration. */
const wantsRoadSpur = (o: PlacedObject): boolean => !isDecoration(o);

/** A point the network connects, tagged with its buildable region: the one hub it is rooted at, or a
 *  hamlet (a standing building) it reaches. */
export interface Node {
  kind: 'hub' | 'hamlet';
  pos: MacroCoord;
  region: number;
}
const pairKey = (p: Portal): string => regionPairKey(p.regionA, p.regionB);

/** The shared mutable plumbing threaded through every road-network phase. The three route-laying
 *  closures (`pavePath`/`linkToNetwork`/`realizePortal`) capture the same Set instances stored here, so
 *  phases and closures mutate one shared state — never copies. */
interface NetCtx extends MapGrid {
  ctx: PlaceCtx;
  a: PlacementAnalysis;
  roadId: string;
  regionAdj: Map<number, Portal[]>;
  center: MacroCoord;
  maxNodes: number;
  turnPenalty: number;  // A* cost per direction change (turnPenaltyFor; 0 = organic winding)
  vary: NetworkVariation;   // the run's seeded shaping decisions
  cost: AstarCost;          // what every astar call in this run pays beyond the step cost
  hub: Node;
  hubObj: PlacedObject | undefined;
  objs: PlacedObject[];
  occupied: Set<number>;
  road: Set<number>;    // road cells (the network; cheap to reuse, traversable)
  extra: Set<number>;   // bridge/ramp footprint + apron cells (passable links over water/cliffs)
  network: Set<number>;
  placedPairs: Set<string>;
  crossings: PlacedObject[];   // every crossing the spanning tree realized
  passable: (x: number, y: number) => boolean;
  pavePath: (path: MacroCoord[]) => void;
  linkToNetwork: (from: MacroCoord | null) => boolean;
  realizePortal: (p: Portal) => boolean;
}

/** The router's seed and the road tile it paves with. */
export interface NetworkStyle { variation: number; surfaceId?: string }

/** Pools/hub setup + the three shared route-laying closures. Returns null on the early-outs (no road tile,
 *  no hub node, or no reachable network seed) — connectRoadNetwork then returns without doing any work. */
function setupNet(
  ctx: PlaceCtx, a: PlacementAnalysis, nodes: Node[], regionAdj: Map<number, Portal[]>, { variation, surfaceId }: NetworkStyle,
): NetCtx | null {
  const { width: W, height: H } = a;
  const roadPool = getPlaceableWhere(isCoating);
  const roadId = roadPool.find((r) => r.id === surfaceId)?.id ?? roadPool[0]?.id;
  const mainBridgeId = mainCrossingId('bridge');
  const mainRampId = mainCrossingId('ramp');
  if (!roadId) return null;
  const hub = nodes.find((n) => n.kind === 'hub');
  if (!hub) return null;

  const grid = mapGrid(W, H);
  const { idx, inB } = grid;
  const objs = [...ctx.state.objects.values()];
  const occupied = new Set<number>();
  for (const o of objs) if (!o.locked) forEachFootprintCell(o, (x, y) => { if (inB(x, y)) occupied.add(idx(x, y)); });
  const walkable = (i: number): boolean => a.open[i] === 1 && !occupied.has(i);
  const road = new Set<number>();
  const extra = new Set<number>();
  const passable = (x: number, y: number): boolean => { if (!inB(x, y)) return false; const i = idx(x, y); return walkable(i) || road.has(i) || extra.has(i); };
  const maxNodes = Math.max(TUNING.networkMaxNodesFloor, W * H);
  const center = hub.pos;
  const turnPenalty = turnPenaltyFor(ctx.naturalness);
  const vary = makeNetworkVariation(variation, road, W);
  const cost = vary.cost;

  // The hub object (the anchor landmark, or whatever sits at the hub point) is the connective core: a road need only
  // reach its perimeter to be joined to the rest "through" it (you cross the landmark). Mark its footprint
  // in-network + passable so links from every side converge on one physical component — a virtual band of
  // bare cells would leave roads terminating near, but not joined to, each other.
  const network = new Set<number>();
  const hubObj = objs.find((o) => { const r = objectRect(o); return rectContains(r, hub.pos.x, hub.pos.y); });
  if (hubObj) forEachFootprintCell(hubObj, (x, y) => { if (inB(x, y)) { network.add(idx(x, y)); extra.add(idx(x, y)); } });
  else if (inB(hub.pos.x, hub.pos.y)) { const i = idx(hub.pos.x, hub.pos.y); network.add(i); if (!walkable(i)) extra.add(i); }
  if (network.size === 0) { const w = nearestWalkable(center, a, occupied, W, H); if (!w) return null; network.add(idx(w.x, w.y)); }

  // Pave an A* path into the network: lay a road tile on every walkable cell that can take one (a flat-rule
  // failure beside water/edge leaves bare grass, still traversable) and join every path cell to the network
  // so the route is walkable end-to-end. Shared by every road-laying step below.
  const pavePath = (path: MacroCoord[]): void => {
    for (const c of path) { const i = idx(c.x, c.y); if (walkable(i) && !road.has(i)) { if (tryPlace(ctx, roadId, c.x, c.y)) road.add(i); } network.add(i); }
  };

  // A* a passable start cell (walkable grass / road / crossing apron) to the network and pave the path:
  // every path cell joins the network (so the route is walkable end-to-end), and a road tile is laid wherever
  // one is placeable. A few cells can't take a road tile (a flat trait fails next to water or off the map
  // edge) — there the route crosses open grass, which is still traversable, so the link stands.
  const linkToNetwork = (from: MacroCoord | null): boolean => {
    if (!from || !passable(from.x, from.y)) return false;
    if (network.has(idx(from.x, from.y))) return true;
    const path = astar(from, network, { passable, W, H, road, center, maxNodes, turnPenalty, cost });
    if (!path) return false;
    pavePath(path);
    return true;
  };

  // Place a portal's crossing (bridge/ramp) and connect both banks: footprint + a 1-ring apron go into
  // `extra` so the open approaches (which sit past the eroded shore) can route across to the network.
  const placedPairs = new Set<string>();
  const crossings: PlacedObject[] = [];
  // A crossing's footprint and the ring around it, which reaches over the shore ring, are walkable.
  const walkCrossing = (o: PlacedObject): void => forEachFootprintCell(o, (x, y) => {
    if (inB(x, y)) extra.add(idx(x, y));
    for (const [dx, dy] of NEIGHBORS4) if (inB(x + dx, y + dy)) extra.add(idx(x + dx, y + dy));
  });

  // A deck that already stands is a crossing that already happened. Its cells and their apron go
  // into `extra` so a route may walk it, and its two banks' regions go into `placedPairs` so the
  // spanning tree treats that pair as linked: without the second half the router reads the two banks
  // as unjoined regions and builds a second bridge beside the one the user already put there.
  {
    const regionBeyond = (from: MacroCoord, dx: number, dy: number): number => {
      for (let d = 0; d <= TUNING.portalScanReach; d++) {
        const x = from.x + dx * d, y = from.y + dy * d;
        if (!inB(x, y)) return -1;
        const r = a.region[idx(x, y)]!;
        if (r >= 0) return r;
      }
      return -1;
    };
    for (const o of objs) {
      if (!isCrossing(getCatalogItem(o.catalogId))) continue;
      walkCrossing(o);
      const [exitA, exitB] = crossingExitCells(o);
      const eA = exitA[0], eB = exitB[0];
      if (!eA || !eB) continue;
      const dx = Math.sign(eA.x - eB.x), dy = Math.sign(eA.y - eB.y);
      const rA = regionBeyond(eA, dx, dy), rB = regionBeyond(eB, -dx, -dy);
      if (rA >= 0 && rB >= 0 && rA !== rB) placedPairs.add(regionPairKey(rA, rB));
    }
  }
  const realizePortal = (p: Portal): boolean => {
    if (placedPairs.has(pairKey(p))) return true;
    const id = p.kind === 'bridge' ? mainBridgeId : mainRampId;
    if (!id) return false;
    const sites = [p, ...(regionAdj.get(p.regionA) ?? []).filter((q) => q !== p && pairKey(q) === pairKey(p))];
    // The first site that places wins, so which one a seed offers first is which crossing gets built.
    for (const c of vary.order(sites, VARY.crossingSite)) {
      const crossing = tryPlace(ctx, id, c.anchor.x, c.anchor.y);
      if (!crossing) continue;
      walkCrossing(crossing);
      // Entrance clearance. A decoration already standing there was placed by a hand and stays: the
      // cells are reserved, and the route goes round it.
      for (const c of crossingEndClearance(crossing)) if (inB(c.x, c.y)) ctx.clearance.add(idx(c.x, c.y));
      placedPairs.add(pairKey(c));
      crossings.push(crossing);
      linkToNetwork(c.approachA); linkToNetwork(c.approachB);
      return true;
    }
    return false;
  };

  return {
    ...grid, ctx, a, roadId, regionAdj,
    center, maxNodes, turnPenalty, vary, cost, hub, hubObj, objs, occupied, road, extra, network, placedPairs,
    crossings, passable, pavePath, linkToNetwork, realizePortal,
  };
}

/** Prim-like spanning over the non-hub nodes: attach the cheapest reachable node each round,
 *  realizing the portal path to it, then connecting its cluster with roads. */
function primSpanningTree(net: NetCtx, nodes: Node[]): void {
  const { a, W, H, occupied, regionAdj, vary } = net;
  const connected = new Set<number>([net.hub.region]);
  // The order is the trunk. The first node in a connected region is attached before any other, so
  // this list decides what the network grows out of and which streets become the spines it hangs on.
  const joinable = nodes.filter((n) => n.kind !== 'hub');
  const remaining = new Set(vary.order(joinable, VARY.joinOrder));
  // The chain is chosen by one weight, so it is compared by the same one — mixing the two would rank
  // a chain the Dijkstra never offered above the one it did.
  const weigh = vary.weight;
  let guard = remaining.size + 1;
  while (remaining.size && guard-- > 0) {
    let pick: Node | null = null, pickPath: Portal[] = [], pickCost = Infinity;
    for (const n of remaining) {
      if (connected.has(n.region)) { pick = n; pickPath = []; break; } // same region → free, do first
      const path = routeRegionsMulti(connected, n.region, regionAdj, vary.weight);
      if (path) { const cost = path.reduce((s, p) => s + weigh(p), 0); if (cost < pickCost) { pick = n; pickPath = path; pickCost = cost; } }
    }
    if (!pick) break; // remaining nodes are in regions with no portal path → leave them placed but unlinked
    remaining.delete(pick);
    for (const p of pickPath) { if (!net.realizePortal(p)) break; connected.add(p.regionA); connected.add(p.regionB); }
    net.linkToNetwork(nearestWalkable(pick.pos, a, occupied, W, H));
    connected.add(pick.region);
  }
}

/** Spurs from every building door to the network. Runs twice: once right after the spanning tree
 *  (streets grow outward from the doors), and again after the crossing connections — a house whose
 *  room only became reachable through a crossing tied in late gets its door spur on the retry (the
 *  early pass had nothing to link to). */
function doorSpurs(net: NetCtx): void {
  const { ctx, a, W, H, occupied, objs } = net;
  // Reachability precheck: a building in a component the network cannot reach would
  // send one full A* flood per candidate door (up to ~100 doors per building). One
  // BFS from the network answers "can any door here connect at all?" for the whole
  // pass — paving only re-marks already-passable cells, so the flood stays valid.
  const reach = networkReach(net);
  for (const b of objs) if (!b.locked && wantsRoadSpur(b)) {
    const r = objectRect(b);
    let doors: MacroCoord[];
    const item = getCatalogItem(b.catalogId);
    if (item && hasGate(item)) {
      // Regulation: a house's gate is the centre of its bottom edge at rotation 0, and it rotates
      // with the house (90 → faces -x, 180 → -y, 270 → +x — the sprite/mesh convention). Connect
      // the road at the gate approach first (ring-search fallback), and reserve a 3-wide × 2-deep
      // clearance strip over the gate + approach so the entrance stays open.
      // A decoration on the strip was placed by a hand and stays; the strip is still reserved.
      const { approach, clear } = buildingGate(r, b.rotation);
      for (const c of clear) if (net.inB(c.x, c.y)) ctx.clearance.add(net.idx(c.x, c.y));
      doors = [approach, ...approachCells(r, a, W, H, occupied)];
    } else {
      doors = approachCells(r, a, W, H, occupied);
    }
    // Which side the street arrives on: the first candidate that reaches the network wins. The head
    // stays put — the gate approach where a regulation names one, the nearest ring cell where it
    // does not — and the rest, which are equals ranked only by how the ring was walked, reorder.
    doors = orderTail(net.vary, doors, VARY.doorSide);
    for (const door of doors) {
      if (net.inB(door.x, door.y) && !reach[net.idx(door.x, door.y)]) continue; // provably unreachable — skip the A*
      if (net.linkToNetwork(door)) break; // first door that reaches the network wins
    }
  }
}

/** Cells reachable from the current network over `passable` — one BFS per doorSpurs
 *  pass, shared by every door's skip test. */
function networkReach(net: NetCtx): Uint8Array {
  const { W, network } = net;
  const reach = new Uint8Array(W * net.H);
  const queue: number[] = [];
  for (const i of network) if (i >= 0 && i < reach.length && !reach[i]) { reach[i] = 1; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (!net.passable(nx, ny)) continue;
      const ni = ny * W + nx;
      if (!reach[ni]) { reach[ni] = 1; queue.push(ni); }
    }
  }
  return reach;
}

/** The exit cells just outside both short edges of a crossing, full deck width — a 2-wide ramp has
 *  two exit cells per end, and a building may block one while the other stays open. */
export function crossingExitCells(obj: PlacedObject): [MacroCoord[], MacroCoord[]] {
  const r = objectRect(obj);
  const horizontal = crossingRunsAlongX(obj);
  const A: MacroCoord[] = [], B: MacroCoord[] = [];
  if (horizontal) {
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) { A.push({ x: Math.floor(r.x) - 1, y }); B.push({ x: Math.ceil(r.x + r.w), y }); }
  } else {
    for (let x = Math.floor(r.x); x < r.x + r.w; x++) { A.push({ x, y: Math.floor(r.y) - 1 }); B.push({ x, y: Math.ceil(r.y + r.h) }); }
  }
  return [A, B];
}

/** Regulation: every realized ramp/bridge is used by the road network, not merely touched. For each
 *  crossing the spanning tree realized: tie both end
 *  cells into the wider street network, pave a route bank→bank across the deck (its footprint is the
 *  only passable link between the levels/banks, so the route provably traverses the crossing), and
 *  lay a road tile directly on each end cell where the flat rule allows — so the pavement runs up to
 *  the entrance and out of the exit. A crossing neither of whose banks reaches the network (an
 *  isolated pocket, or the far end of a chain whose nearer crossing could not be tied in) is taken
 *  back. */
function crossingConnections(net: NetCtx): void {
  const { W, center, maxNodes, road, passable } = net;
  // Two passes: a crossing whose route to the network runs through another crossing can only link
  // after that one's connection exists — the second pass resolves such chains.
  const linked = new Set<PlacedObject>();
  for (const obj of [...net.crossings, ...net.crossings]) {
    const [edgeA, edgeB] = crossingExitCells(obj);
    const [eA, eB] = crossingEnds(obj);
    // Tie each end into the existing network first (routes pave roads as they go), trying every exit
    // cell across the deck width — a building may block the centre one while a side cell is open.
    let linkedA = false; for (const c of edgeA) if (net.linkToNetwork(c)) { linkedA = true; break; }
    let linkedB = false; for (const c of edgeB) if (net.linkToNetwork(c)) { linkedB = true; break; }
    if (!linkedA && !linkedB) continue;
    linked.add(obj);
    // Bank→bank across the deck: guarantees the through-route is paved on both approaches.
    const path = astar(eA, new Set([net.idx(eB.x, eB.y)]), {
      passable, W, H: net.H, road, center, maxNodes, turnPenalty: net.turnPenalty, cost: net.cost,
    });
    if (path) net.pavePath(path);
    // Road tiles directly on the exit cells, then a short driveway ray continuing outward from each
    // end centre — the flat rule often refuses the tile right at the transition beside a cliff/water
    // edge, so without the ray the pavement would die at the deck instead of running out of the exit.
    net.pavePath(edgeA); net.pavePath(edgeB);
    for (const [e, other] of [[eA, eB], [eB, eA]] as [MacroCoord, MacroCoord][]) {
      const dx = Math.sign(e.x - other.x), dy = Math.sign(e.y - other.y);
      net.pavePath([{ x: e.x + dx, y: e.y + dy }, { x: e.x + 2 * dx, y: e.y + 2 * dy }]);
    }
  }
  // A crossing neither end of which reaches the network is a ramp or a deck in bare ground. It comes
  // off, and its deck and apron stop being walkable, so no later route steps across the gap it spanned.
  const stranded = net.crossings.filter((obj) => !linked.has(obj));
  if (!stranded.length) return;
  net.crossings.splice(0, net.crossings.length, ...net.crossings.filter((obj) => linked.has(obj)));
  const deckAndApron = (obj: PlacedObject, visit: (i: number) => void): void => forEachFootprintCell(obj, (x, y) => {
    if (net.inB(x, y)) visit(net.idx(x, y));
    for (const [dx, dy] of NEIGHBORS4) if (net.inB(x + dx, y + dy)) visit(net.idx(x + dx, y + dy));
  });
  const kept = new Set<number>();
  for (const obj of [...net.crossings, ...net.objs.filter((o) => isCrossing(getCatalogItem(o.catalogId)))]) deckAndApron(obj, (i) => kept.add(i));
  for (const obj of stranded) {
    removePlaced(net.ctx, obj);
    deckAndApron(obj, (i) => { if (!kept.has(i)) net.extra.delete(i); });
  }
}

/** Hub ring: pave the walkable cells around the hub object's perimeter so roads enter the town centre
 *  from every side via a loop, not a single stub. */
function hubRing(net: NetCtx): void {
  const { hubObj } = net;
  if (hubObj) {
    const r = objectRect(hubObj), x0 = Math.floor(r.x) - 1, y0 = Math.floor(r.y) - 1, x1 = Math.ceil(r.x + r.w), y1 = Math.ceil(r.y + r.h);
    for (let x = x0; x <= x1; x++) { net.linkToNetwork({ x, y: y0 }); net.linkToNetwork({ x, y: y1 }); }
    for (let y = y0 + 1; y < y1; y++) { net.linkToNetwork({ x: x0, y }); net.linkToNetwork({ x: x1, y }); }
  }
}

/** Loop closure: link neighbouring hamlets directly so exploration runs in circuits, not dead-end
 *  spokes. The A* reuse discount collapses redundant links onto existing streets — and routes through
 *  already-placed bridges/ramps via their aprons — so a loop only paves where a genuine shortcut exists,
 *  and crossings earn their keep as through-routes. */
function hamletLoopClosure(net: NetCtx, nodes: Node[]): void {
  const { a, W, H, occupied, center, maxNodes, road, network, passable } = net;
  const hamlets = nodes.filter((n) => n.kind === 'hamlet');
  if (hamlets.length >= 2) {
    const ang = (n: Node): number => Math.atan2(n.pos.y - center.y, n.pos.x - center.x);
    const byAngle = [...hamlets].sort((p, q) => ang(p) - ang(q));
    for (let k = 0; k < byAngle.length; k++) {
      if (byAngle.length === 2 && k === 1) break; // two hamlets → one link, not a duplicate back-edge
      const A = byAngle[k]!, B = byAngle[(k + 1) % byAngle.length]!;
      if (Math.hypot(A.pos.x - B.pos.x, A.pos.y - B.pos.y) > TUNING.loopMaxDist) continue;
      const from = nearestWalkable(A.pos, a, occupied, W, H);
      const toW = nearestWalkable(B.pos, a, occupied, W, H);
      if (!from || !toW) continue;
      const goals = new Set<number>();
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const gx = toW.x + dx, gy = toW.y + dy;
        if (net.inB(gx, gy) && network.has(net.idx(gx, gy))) goals.add(net.idx(gx, gy));
      }
      if (!goals.size || goals.has(net.idx(from.x, from.y))) continue;
      const path = astar(from, goals, {
        passable, W, H: net.H, road, center: toW, maxNodes, turnPenalty: net.turnPenalty, cost: net.cost,
      });
      if (!path) continue;
      net.pavePath(path);
    }
  }
}

/** Connect what stands on a live map into one road network rooted at the hub: a Prim-like spanning
 *  tree where inter-region hops cross portals (bridges over fords, ramps up tiers) and intra-region
 *  links are directed A* roads, plus short spurs from each building to the network. Rule-valid by
 *  construction (every road/bridge/ramp via tryPlace). Lays roads, bridges and ramps only: a
 *  decoration in the way stays (the route goes round it), and a crossing already standing is one the
 *  route may walk. `style.variation` seeds the router's shaping decisions (`network-variation.ts`), so
 *  pressing again offers another layout. `style.surfaceId` picks the road tile to pave with; anything
 *  outside the road pool falls back to its first entry, so a stale id lays the default surface
 *  rather than nothing at all. */
export function connectRoadNetwork(
  ctx: PlaceCtx, a: PlacementAnalysis, nodes: Node[], regionAdj: Map<number, Portal[]>, style: NetworkStyle,
): void {
  if (!nodes.length) return;
  const net = setupNet(ctx, a, nodes, regionAdj, style);
  if (!net) return;
  primSpanningTree(net, nodes);
  doorSpurs(net);
  hubRing(net);
  hamletLoopClosure(net, nodes);
  crossingConnections(net);
  doorSpurs(net);          // retry: rooms opened by late crossings link their doors now
}

/** Nearest walkable (open + unoccupied) cell to `p`, scanning rings out to doorSearchRadius. */
export function nearestWalkable(p: MacroCoord, a: PlacementAnalysis, occupied: Set<number>, W: number, H: number): MacroCoord | null {
  const { inB, idx } = mapGrid(W, H);
  const ok = (x: number, y: number) => inB(x, y) && a.open[idx(x, y)] === 1 && !occupied.has(idx(x, y));
  if (ok(p.x, p.y)) return p;
  for (let d = 1; d <= TUNING.doorSearchRadius; d++) {
    for (let x = p.x - d; x <= p.x + d; x++) { if (ok(x, p.y - d)) return { x, y: p.y - d }; if (ok(x, p.y + d)) return { x, y: p.y + d }; }
    for (let y = p.y - d + 1; y < p.y + d; y++) { if (ok(p.x - d, y)) return { x: p.x - d, y }; if (ok(p.x + d, y)) return { x: p.x + d, y }; }
  }
  return null;
}

/** Candidate door cells near a building's footprint that A* can route from (walkable + an orthogonal open
 *  neighbour, since A* is 4-connected), nearest ring first; the spur tries each until one reaches the
 *  network, so a building beside a region edge can connect from whichever side actually links. */
export function approachCells(
  r: { x: number; y: number; w: number; h: number }, a: PlacementAnalysis, W: number, H: number, occupied: Set<number>,
): MacroCoord[] {
  const { inB, idx } = mapGrid(W, H);
  const wlk = (x: number, y: number): boolean => inB(x, y) && a.open[idx(x, y)] === 1 && !occupied.has(idx(x, y));
  const hasOrthOpen = (x: number, y: number): boolean => NEIGHBORS4.some(([dx, dy]) => wlk(x + dx, y + dy));
  const x0 = Math.floor(r.x), y0 = Math.floor(r.y), x1 = Math.ceil(r.x + r.w) - 1, y1 = Math.ceil(r.y + r.h) - 1;
  const ring = (d: number): MacroCoord[] => {
    const lx = x0 - d, rx = x1 + d, ty = y0 - d, by = y1 + d, out: MacroCoord[] = [];
    for (let x = lx; x <= rx; x++) { out.push({ x, y: ty }); out.push({ x, y: by }); }
    for (let y = ty + 1; y < by; y++) { out.push({ x: lx, y }); out.push({ x: rx, y }); }
    return out;
  };
  const good: MacroCoord[] = [], any: MacroCoord[] = [];
  for (let d = 1; d <= TUNING.doorSearchRadius; d++) for (const c of ring(d)) if (wlk(c.x, c.y)) (hasOrthOpen(c.x, c.y) ? good : any).push(c);
  return [...good, ...any]; // prefer doors with an open neighbour, then any walkable cell
}

/** A profile's extra costs, layered on top of the road/ground step. Absent ⇒ the classic
 *  arithmetic, byte for byte. */
export interface AstarCost {
  /** Extra cost for entering `i` from `prev`. Alignment discounts and the scenic bonus ride here. */
  enter?: (i: number, prev: number) => number;
  /** Cost for turning at `i`, replacing the flat `turnPenalty` where a profile wants its own. */
  turn?: (i: number, prev: number) => number;
}

/** One search's per-cell arrays, sized to `cap` cells. `gen` stamps the current search: `mark[i]`
 *  holds an entry valid for it iff it equals `gen`, and `seen[i]` a settled cell likewise. */
interface AstarBuffers {
  cap: number;
  gen: number;
  g: Float64Array;
  came: Int32Array;
  mark: Int32Array;
  seen: Int32Array;
}

/* A* scratch buffers, shared across calls (not reentrant — the generator is single-
 * threaded and astar never nests). A generation stamp marks which entries belong to
 * the current call, so a new search costs no clearing: ~250 searches per generated
 * map otherwise allocate fresh Maps/Sets over a ~24k-cell grid each. */
let astarBuffers: AstarBuffers = {
  cap: 0, gen: 0, g: new Float64Array(0), came: new Int32Array(0), mark: new Int32Array(0), seen: new Int32Array(0),
};

function ensureAstarBuffers(cells: number): AstarBuffers {
  if (cells > astarBuffers.cap) {
    astarBuffers = {
      cap: cells, gen: 0, g: new Float64Array(cells), came: new Int32Array(cells), mark: new Int32Array(cells), seen: new Int32Array(cells),
    };
  }
  return astarBuffers;
}

/** Directed A* (Manhattan-to-hub heuristic, index tie-break → deterministic) from start to any goal cell
 *  over `passable`, preferring existing road. `turnPenalty` adds cost per direction change (the
 *  rectilinear style's long straight streets; 0 keeps the classic obstacle-driven winding — the
 *  penalty is approximate, read off the settled parent direction rather than a (cell,dir) state
 *  space, which is exact enough for road styling and stays deterministic). Returns the path
 *  (incl. start + goal) or null. Superseded heap entries (a node improved after being pushed, or
 *  already expanded) are skipped by lazy deletion: a node's best entry always pops first (g only
 *  ever decreases, and each decrease pushes a strictly better entry), so a later pop is stale. */
export interface AstarSearch {
  passable: (x: number, y: number) => boolean;
  W: number;
  H: number;
  /** Cells already paved, which the search prefers. */
  road: Set<number>;
  /** The hub the heuristic measures toward. */
  center: MacroCoord;
  maxNodes: number;
  turnPenalty: number;
  cost?: AstarCost;
}

export function astar(start: MacroCoord, goals: Set<number>, search: AstarSearch): MacroCoord[] | null {
  const { passable, W, H, road, center, maxNodes, turnPenalty, cost } = search;
  const si = start.y * W + start.x;
  if (goals.has(si)) return [start];
  const buffers = ensureAstarBuffers(W * H);
  const { g: gBuf, came: cameBuf, mark: markBuf, seen: seenBuf } = buffers;
  const gen = ++buffers.gen;
  const h = (i: number): number => (Math.abs((i % W) - center.x) + Math.abs(((i / W) | 0) - center.y)) * TUNING.roadReuseCost;
  gBuf[si] = 0; cameBuf[si] = -1; markBuf[si] = gen;
  const open = new IndexHeap();
  open.push(h(si), si);
  let guard = 0;
  while (open.size) {
    const cur = open.pop();
    if (seenBuf[cur] === gen) continue; // stale heap entry — this node's best entry already popped
    if (guard++ >= maxNodes) return null;
    if (goals.has(cur)) return reconstruct(buffers, cur, W);
    seenBuf[cur] = gen;
    const gcur = markBuf[cur] === gen ? gBuf[cur]! : Infinity;
    const x = cur % W, y = (cur / W) | 0;
    const pi = markBuf[cur] === gen ? cameBuf[cur]! : -1; // settled parent → the direction the path enters `cur` with
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (!passable(nx, ny)) continue;
      const ni = ny * W + nx;
      if (seenBuf[ni] === gen) continue;
      // The gate opens for a profile's own turn cost even at turnPenalty 0, or the 'straight'
      // profile would silently equal 'short' on every organic-default map. With no `cost` the
      // arithmetic is exactly the classic one.
      const turn = (turnPenalty > 0 || cost?.turn) && pi >= 0 && ni - cur !== cur - pi
        ? (cost?.turn?.(ni, cur) ?? turnPenalty) : 0;
      const ng = gcur + (road.has(ni) ? TUNING.roadReuseCost : TUNING.roadCost) + turn + (cost?.enter?.(ni, cur) ?? 0);
      const known = markBuf[ni] === gen ? gBuf[ni]! : Infinity;
      if (ng < known) { cameBuf[ni] = cur; gBuf[ni] = ng; markBuf[ni] = gen; open.push(ng + h(ni), ni); }
    }
  }
  return null;
}

function reconstruct({ gen, mark, came }: AstarBuffers, end: number, W: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  let c = end;
  while (c >= 0 && mark[c] === gen) { out.push({ x: c % W, y: (c / W) | 0 }); c = came[c]!; }
  return out.reverse();
}
