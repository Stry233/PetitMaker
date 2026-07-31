import { ItemCategory, type CatalogItem, type MacroCoord, type PlacedObject } from '../../../core/model/types';
import { NEIGHBORS4 } from '../../../core/model/grid-model';
import { TUNING } from '../tuning';
import { makeRng, type Rng } from '../../../core/model/rng';
import { objectRect } from '../../../state/object-geometry';
import { tryPlace, tryDecorate, sweepClearanceCells, forEachFootprintCell, buildingGate, hasGate, type PlaceCtx } from './object';
import { getPlaceableByCategory, getCatalogItem, isDecoration } from '../../../state/catalog';
import type { PlacementAnalysis } from './analysis';
import { routeRegionsMulti, type Portal } from './portals';
import type { Node } from './settlement';
import { geoStyle } from '../style';
import type { ZonePlan } from '../types';
import { realizeCrossings, crossingEnds } from './themes';
import { bySizeDesc } from '../geometry';

/** Everything a road should reach: every placed object except the vegetation. Buildings and
 *  facilities want a door spur, and a road/bridge/ramp is already part of the network it links
 *  into, so the one thing to leave out is decoration. */
const wantsRoadSpur = (o: PlacedObject): boolean => !isDecoration(o);
const pairKey = (p: Portal): string => (p.regionA < p.regionB ? `${p.regionA},${p.regionB}` : `${p.regionB},${p.regionA}`);

/** The shared mutable plumbing threaded through every road-network phase. The three route-laying
 *  closures (`pavePath`/`linkToNetwork`/`realizePortal`) capture the SAME Set instances stored here, so
 *  phases and closures mutate one shared state — never copies. */
interface NetCtx {
  ctx: PlaceCtx;
  a: PlacementAnalysis;
  W: number;
  H: number;
  roadId: string;
  bridgePool: CatalogItem[];
  rampPool: CatalogItem[];
  mainBridgeId: string | undefined;
  mainRampId: string | undefined;
  stylePick: Rng;
  regionAdj: Map<number, Portal[]>;
  center: MacroCoord;
  maxNodes: number;
  turnPenalty: number;  // A* cost per direction change (geoStyle; 0 = organic winding)
  hub: Node;
  hubObj: PlacedObject | undefined;
  objs: PlacedObject[];
  occupied: Set<number>;
  road: Set<number>;    // road cells (the network; cheap to reuse, traversable)
  extra: Set<number>;   // bridge/ramp footprint + apron cells (passable links over water/cliffs)
  network: Set<number>;
  placedPairs: Set<string>;
  realizedPlanned: number;
  crossings: PlacedObject[];   // every realized crossing (planned + spanning-tree + scenic)
  idx: (x: number, y: number) => number;
  inB: (x: number, y: number) => boolean;
  passable: (x: number, y: number) => boolean;
  pavePath: (path: MacroCoord[]) => void;
  linkToNetwork: (from: MacroCoord | null) => boolean;
  realizePortal: (p: Portal, scenic?: boolean) => boolean;
}

/** Pools/hub setup + the three shared route-laying closures. Returns null on the early-outs (no road tile,
 *  no hub node, or no reachable network seed) — buildNetwork then returns without doing any work. */
function setupNet(ctx: PlaceCtx, a: PlacementAnalysis, nodes: Node[], regionAdj: Map<number, Portal[]>): NetCtx | null {
  const { width: W, height: H } = a;
  const roadId = getPlaceableByCategory(ItemCategory.Road)[0]?.id;
  // Bridges/ramps with CHARACTER: the main (spanning-tree) crossings get the grandest bridge (largest
  // footprint — the stone one), scenic crossings draw varied designs from the whole pool by seed.
  const bridgePool = getPlaceableByCategory(ItemCategory.Bridge);
  const rampPool = getPlaceableByCategory(ItemCategory.Ramp);
  const grandest = (pool: typeof bridgePool) => [...pool].sort(bySizeDesc)[0]?.id;
  const mainBridgeId = grandest(bridgePool), mainRampId = rampPool[0]?.id;
  const stylePick = makeRng(ctx.seed ^ 0xb71d6e);
  if (!roadId) return null;
  const hub = nodes.find((n) => n.kind === 'hub');
  if (!hub) return null;

  const idx = (x: number, y: number): number => y * W + x;
  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const objs = [...ctx.state.objects.values()];
  const occupied = new Set<number>();
  for (const o of objs) if (!o.locked) forEachFootprintCell(o, (x, y) => { if (inB(x, y)) occupied.add(idx(x, y)); });
  const walkable = (i: number): boolean => a.open[i] === 1 && !occupied.has(i);
  const road = new Set<number>();
  const extra = new Set<number>();
  const passable = (x: number, y: number): boolean => { if (!inB(x, y)) return false; const i = idx(x, y); return walkable(i) || road.has(i) || extra.has(i); };
  const maxNodes = Math.max(TUNING.networkMaxNodesFloor, W * H);
  const center = hub.pos;
  const turnPenalty = geoStyle(ctx.naturalness).turnPenalty;

  // The hub object (plaza, or whatever sits at the hub point) is the connective CORE: a road need only
  // reach its perimeter to be joined to the rest "through" it (you cross the plaza). Mark its footprint
  // in-network + passable so links from every side converge on one physical component — a virtual band of
  // bare cells would leave roads terminating near, but not joined to, each other.
  const network = new Set<number>();
  const hubObj = objs.find((o) => { const r = objectRect(o); return hub.pos.x >= r.x && hub.pos.x < r.x + r.w && hub.pos.y >= r.y && hub.pos.y < r.y + r.h; });
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
    const path = astar(from, network, passable, W, H, road, center, maxNodes, turnPenalty);
    if (!path) return false;
    pavePath(path);
    return true;
  };

  // Place a portal's crossing (bridge/ramp) and connect both banks: footprint + a 1-ring apron go into
  // `extra` so the open approaches (which sit past the eroded shore) can route ACROSS to the network.
  const placedPairs = new Set<string>();
  const crossings: PlacedObject[] = [];
  const realizePortal = (p: Portal, scenic = false): boolean => {
    if (placedPairs.has(pairKey(p))) return true;
    const pool = p.kind === 'bridge' ? bridgePool : rampPool;
    const main = p.kind === 'bridge' ? mainBridgeId : mainRampId;
    const id = scenic && pool.length ? pool[stylePick.int(pool.length)]!.id : main;
    if (!id) return false;
    const candidates = [p, ...(regionAdj.get(p.regionA) ?? []).filter((q) => q !== p && pairKey(q) === pairKey(p))];
    for (const c of candidates) {
      const crossing = tryPlace(ctx, id, c.anchor.x, c.anchor.y)
        ?? (id !== main && main ? tryPlace(ctx, main, c.anchor.x, c.anchor.y) : null); // styled pick may not fit — fall back
      if (!crossing) continue;
      forEachFootprintCell(crossing, (x, y) => {
        if (inB(x, y)) extra.add(idx(x, y));
        for (const [dx, dy] of NEIGHBORS4) if (inB(x + dx, y + dy)) extra.add(idx(x + dx, y + dy)); // apron over the shore ring
      });
      const ends3 = new Set<number>();
      for (const e of crossingEnds(crossing)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (inB(e.x + dx, e.y + dy)) ends3.add(idx(e.x + dx, e.y + dy)); }
      for (const i of ends3) ctx.clearance.add(i); // 3×3 entrance clearance
      // Open the approaches NOW: themed decor placed before this crossing existed would block the
      // road routing below (occupied cells aren't passable) — sweep it and free its cells.
      for (const o of sweepClearanceCells(ctx, ends3)) forEachFootprintCell(o, (x, y) => { if (inB(x, y)) occupied.delete(idx(x, y)); });
      placedPairs.add(pairKey(c));
      crossings.push(crossing);
      linkToNetwork(c.approachA); linkToNetwork(c.approachB);
      return true;
    }
    return false;
  };

  return {
    ctx, a, W, H, roadId, bridgePool, rampPool, mainBridgeId, mainRampId, stylePick, regionAdj,
    center, maxNodes, turnPenalty, hub, hubObj, objs, occupied, road, extra, network, placedPairs,
    realizedPlanned: 0, crossings, idx, inB, passable, pavePath, linkToNetwork, realizePortal,
  };
}

/** PLANNED CROSSINGS (zone path): realize each designed bridge/ramp first and treat its cells +
 *  a 1-ring apron as passable links — the road network then routes THROUGH the design. The
 *  portal machinery below remains the fallback for anything the plan couldn't realize. */
function realizePlannedCrossings(net: NetCtx, zonePlan?: ZonePlan): void {
  const { ctx, a, W } = net;
  if (zonePlan) {
    const settledScenes = new Set<string>();
    const res = realizeCrossings(ctx, a, zonePlan, settledScenes);
    net.realizedPlanned = res.placedCount;
    net.crossings.push(...res.placed);
    for (const obj of res.placed) {
      const ends3 = new Set<number>();
      for (const e of crossingEnds(obj)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (net.inB(e.x + dx, e.y + dy)) ends3.add(net.idx(e.x + dx, e.y + dy)); }
      for (const o of sweepClearanceCells(ctx, ends3)) forEachFootprintCell(o, (x, y) => { if (net.inB(x, y)) net.occupied.delete(net.idx(x, y)); });
    }
    for (const i of res.placedCells) {
      net.extra.add(i);
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) if (net.inB(x + dx, y + dy)) net.extra.add(net.idx(x + dx, y + dy));
    }
  }
}

/** Prim-like spanning over the (non-hub, non-edge) nodes: attach the cheapest reachable node each round,
 *  realizing the portal path to it, then connecting its cluster with roads. */
function primSpanningTree(net: NetCtx, nodes: Node[]): void {
  const { a, W, H, occupied, regionAdj } = net;
  const connected = new Set<number>([net.hub.region]);
  const remaining = new Set(nodes.filter((n) => n.kind !== 'hub' && n.kind !== 'edge'));
  let guard = remaining.size + 1;
  while (remaining.size && guard-- > 0) {
    let pick: Node | null = null, pickPath: Portal[] = [], pickCost = Infinity;
    for (const n of remaining) {
      if (connected.has(n.region)) { pick = n; pickPath = []; break; } // same region → free, do first
      const path = routeRegionsMulti(connected, n.region, regionAdj);
      if (path) { const cost = path.reduce((s, p) => s + p.cost, 0); if (cost < pickCost) { pick = n; pickPath = path; pickCost = cost; } }
    }
    if (!pick) break; // remaining nodes are in regions with no portal path → leave them placed but unlinked
    remaining.delete(pick);
    for (const p of pickPath) { if (!net.realizePortal(p)) break; connected.add(p.regionA); connected.add(p.regionB); }
    net.linkToNetwork(nearestWalkable(pick.pos, a, occupied, W, H));
    connected.add(pick.region);
  }
}

/** External road to the map edge, then short spurs from every building to the nearest road. */
function edgeAndDoorSpurs(net: NetCtx, nodes: Node[]): void {
  const edge = nodes.find((n) => n.kind === 'edge');
  if (edge) net.linkToNetwork(nearestWalkable(edge.pos, net.a, net.occupied, net.W, net.H));
  doorSpurs(net);
}

/** Spurs from every building door to the network. Runs TWICE: once right after the spanning tree
 *  (streets grow outward from the doors), and again after the scenic crossings + crossing
 *  connections — a house whose room only became reachable through a LATE crossing gets its door
 *  spur on the retry (the early pass had nothing to link to). */
function doorSpurs(net: NetCtx): void {
  const { ctx, a, W, H, occupied, objs } = net;
  // Reachability precheck: a building in a component the network cannot reach would
  // send one full A* flood per candidate door (up to ~100 doors per building). One
  // BFS from the network answers "can any door here connect at all?" for the whole
  // pass — paving only re-marks already-passable cells, so the flood stays valid
  // until a doorstep sweep frees an occupied cell (then it recomputes).
  let reach = networkReach(net);
  for (const b of objs) if (!b.locked && wantsRoadSpur(b)) {
    const r = objectRect(b);
    let doors: MacroCoord[];
    const item = getCatalogItem(b.catalogId);
    if (item && hasGate(item)) {
      // REGULATION: a house's gate is the centre of its bottom edge AT ROTATION 0, and it rotates
      // WITH the house (90 → faces -x, 180 → -y, 270 → +x — the sprite/mesh convention). Connect
      // the road at the gate approach first (ring-search fallback), and reserve a 3-wide × 2-deep
      // clearance strip over the gate + approach so the entrance stays open.
      const { approach, clear } = buildingGate(r, b.rotation);
      const strip = new Set<number>();
      for (const c of clear) if (net.inB(c.x, c.y)) { ctx.clearance.add(net.idx(c.x, c.y)); strip.add(net.idx(c.x, c.y)); }
      // Open the doorstep: garden-ring decor placed with the house would block the gate spur.
      let freed = false;
      for (const o of sweepClearanceCells(ctx, strip)) {
        freed = true;
        forEachFootprintCell(o, (x, y) => { if (net.inB(x, y)) occupied.delete(net.idx(x, y)); });
      }
      if (freed) reach = networkReach(net); // the sweep can open a new connection
      doors = [approach, ...approachCells(r, a, W, H, occupied)];
    } else {
      doors = approachCells(r, a, W, H, occupied);
    }
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

/** REGULATION: every realized ramp/bridge is USED by the road network, not merely touched. For each
 *  crossing (planned, spanning-tree AND scenic — this runs after all three phases): tie both end
 *  cells into the wider street network, pave a route bank→bank ACROSS the deck (its footprint is the
 *  only passable link between the levels/banks, so the route provably traverses the crossing), and
 *  lay a road tile directly ON each end cell where the flat rule allows — so the pavement runs up to
 *  the entrance and out of the exit. A crossing whose banks genuinely can't reach the network (an
 *  isolated pocket) is left untouched — "connected when possible". */
/** The exit cells just outside BOTH short edges of a crossing, full deck width — a 2-wide ramp has
 *  two exit cells per end, and a building may block one while the other stays open. */
function crossingExitCells(obj: PlacedObject): [MacroCoord[], MacroCoord[]] {
  const r = objectRect(obj);
  const horizontal = r.w >= r.h;
  const A: MacroCoord[] = [], B: MacroCoord[] = [];
  if (horizontal) {
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) { A.push({ x: Math.floor(r.x) - 1, y }); B.push({ x: Math.ceil(r.x + r.w), y }); }
  } else {
    for (let x = Math.floor(r.x); x < r.x + r.w; x++) { A.push({ x, y: Math.floor(r.y) - 1 }); B.push({ x, y: Math.ceil(r.y + r.h) }); }
  }
  return [A, B];
}

function crossingConnections(net: NetCtx): void {
  const { W, center, maxNodes, road, passable } = net;
  // TWO passes: a crossing whose route to the network runs THROUGH another crossing can only link
  // after that one's connection exists — the second pass resolves such chains.
  for (const obj of [...net.crossings, ...net.crossings]) {
    const [edgeA, edgeB] = crossingExitCells(obj);
    const [eA, eB] = crossingEnds(obj);
    // Tie each end into the existing network FIRST (routes pave roads as they go), trying every exit
    // cell across the deck width — a building may block the centre one while a side cell is open.
    let linkedA = false; for (const c of edgeA) if (net.linkToNetwork(c)) { linkedA = true; break; }
    let linkedB = false; for (const c of edgeB) if (net.linkToNetwork(c)) { linkedB = true; break; }
    if (!linkedA && !linkedB) continue;
    // Bank→bank across the deck: guarantees the through-route is paved on both approaches.
    const path = astar(eA, new Set([net.idx(eB.x, eB.y)]), passable, W, net.H, road, center, maxNodes, net.turnPenalty);
    if (path) net.pavePath(path);
    // Road tiles directly on the exit cells, then a short driveway RAY continuing outward from each
    // end centre — the flat rule often refuses the tile right at the transition beside a cliff/water
    // edge, so without the ray the pavement would die at the deck instead of running out of the exit.
    net.pavePath(edgeA); net.pavePath(edgeB);
    for (const [e, other] of [[eA, eB], [eB, eA]] as [MacroCoord, MacroCoord][]) {
      const dx = Math.sign(e.x - other.x), dy = Math.sign(e.y - other.y);
      net.pavePath([{ x: e.x + dx, y: e.y + dy }, { x: e.x + 2 * dx, y: e.y + 2 * dy }]);
    }
  }
}

/** Plaza ring: pave the walkable cells around the hub object's perimeter so roads enter the town centre
 *  from every side via a loop, not a single stub. */
function plazaRing(net: NetCtx): void {
  const { hubObj } = net;
  if (hubObj) {
    const r = objectRect(hubObj), x0 = Math.floor(r.x) - 1, y0 = Math.floor(r.y) - 1, x1 = Math.ceil(r.x + r.w), y1 = Math.ceil(r.y + r.h);
    for (let x = x0; x <= x1; x++) { net.linkToNetwork({ x, y: y0 }); net.linkToNetwork({ x, y: y1 }); }
    for (let y = y0 + 1; y < y1; y++) { net.linkToNetwork({ x: x0, y }); net.linkToNetwork({ x: x1, y }); }
  }
}

/** LOOP CLOSURE: link neighbouring hamlets directly so exploration runs in circuits, not dead-end
 *  spokes. The A* reuse discount collapses redundant links onto existing streets — and routes THROUGH
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
      const path = astar(from, goals, passable, W, net.H, road, toW, maxNodes, net.turnPenalty);
      if (!path) continue;
      net.pavePath(path);
    }
  }
}

/** Free paving — scenic crossings: realize a few more portals than the spanning tree needed, so fords get
 *  bridged and plateaus get ramped (and road-linked) even where no building sits there. WISE selection:
 *  portals are ranked by the land they unlock (the smaller side's region area), so bridges/ramps lead to
 *  places worth visiting — a big far bank or a roomy plateau — never to a scrap of cliff. */
function scenicFreeCrossings(net: NetCtx): void {
  const { a, regionAdj } = net;
  const uniquePortals: Portal[] = [];
  const seenPair = new Set<string>();
  for (const [, list] of regionAdj) for (const p of list) { const k = pairKey(p); if (!seenPair.has(k)) { seenPair.add(k); uniquePortals.push(p); } }
  const regionSize = (r: number): number => a.regionCells[r]?.length ?? 0;
  uniquePortals.sort((p, q) =>
    Math.min(regionSize(q.regionA), regionSize(q.regionB)) - Math.min(regionSize(p.regionA), regionSize(p.regionB)));
  let scenic = net.realizedPlanned > 0 ? TUNING.scenicCrossingBudget : 0; // designed crossings ARE the scenic pass
  for (const p of uniquePortals) {
    if (scenic >= TUNING.scenicCrossingBudget) break;
    if (net.placedPairs.has(pairKey(p))) continue;
    if (net.realizePortal(p, true)) scenic++;
  }
}

/** Tree-line the roads: scatter a flora/tree beside some road cells so paths read as landscaped, not bare. */
function roadsideTreeLining(net: NetCtx): void {
  const { ctx, a, W, occupied, road, extra } = net;
  const flora = getPlaceableByCategory(ItemCategory.Flora), trees = getPlaceableByCategory(ItemCategory.Tree);
  if (flora.length || trees.length) {
    const rng = makeRng(ctx.seed ^ 0x20ad51de);
    for (const ri of [...road]) {
      if (rng.float() >= TUNING.roadsideChance) continue;
      const rx = ri % W, ry = (ri / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = rx + dx, ny = ry + dy;
        if (!net.inB(nx, ny)) continue;
        const ni = net.idx(nx, ny);
        if (a.open[ni] !== 1 || occupied.has(ni) || road.has(ni) || extra.has(ni)) continue;
        const pool = trees.length && rng.float() < TUNING.roadsideTreeChance ? trees : (flora.length ? flora : trees);
        if (tryDecorate(ctx, pool[rng.int(pool.length)]!.id, nx, ny)) { occupied.add(ni); break; } // respects gate/crossing clearance
      }
    }
  }
}

/** Connect the settlement nodes into one road network rooted at the hub: a Prim-like spanning tree where
 *  inter-region hops cross PORTALS (bridges over fords, ramps up tiers) and intra-region links are directed
 *  A* roads. Plus an external road to the edge node, and short spurs from each building to the network.
 *  Rule-valid by construction (every road/bridge/ramp via tryPlace). A thin dispatcher over the phase
 *  functions above — each runs in the exact original order, sharing one mutable NetCtx. */
export function buildNetwork(ctx: PlaceCtx, a: PlacementAnalysis, settlement: number, nodes: Node[], regionAdj: Map<number, Portal[]>, zonePlan?: ZonePlan): void {
  if (settlement <= 0 || !nodes.length) return;
  const net = setupNet(ctx, a, nodes, regionAdj);
  if (!net) return;
  realizePlannedCrossings(net, zonePlan);
  primSpanningTree(net, nodes);
  edgeAndDoorSpurs(net, nodes);
  plazaRing(net);
  hamletLoopClosure(net, nodes);
  scenicFreeCrossings(net);
  crossingConnections(net);
  doorSpurs(net);          // retry: rooms opened by late crossings link their doors now
  roadsideTreeLining(net);
}

/** Nearest walkable (open + unoccupied) cell to `p`, scanning rings out to doorSearchRadius. */
function nearestWalkable(p: MacroCoord, a: PlacementAnalysis, occupied: Set<number>, W: number, H: number): MacroCoord | null {
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && a.open[y * W + x] === 1 && !occupied.has(y * W + x);
  if (ok(p.x, p.y)) return p;
  for (let d = 1; d <= TUNING.doorSearchRadius; d++) {
    for (let x = p.x - d; x <= p.x + d; x++) { if (ok(x, p.y - d)) return { x, y: p.y - d }; if (ok(x, p.y + d)) return { x, y: p.y + d }; }
    for (let y = p.y - d + 1; y < p.y + d; y++) { if (ok(p.x - d, y)) return { x: p.x - d, y }; if (ok(p.x + d, y)) return { x: p.x + d, y }; }
  }
  return null;
}

/** Candidate door cells near a building's footprint that A* can route FROM (walkable + an orthogonal open
 *  neighbour, since A* is 4-connected), nearest ring first; the spur tries each until one reaches the
 *  network, so a building beside a region edge can connect from whichever side actually links. */
function approachCells(r: { x: number; y: number; w: number; h: number }, a: PlacementAnalysis, W: number, H: number, occupied: Set<number>): MacroCoord[] {
  const wlk = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && a.open[y * W + x] === 1 && !occupied.has(y * W + x);
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

/** Binary min-heap over (f, node-index) pairs. MUST pop in (f, LOWEST insertion-index) order —
 *  routing determinism depends on this exact tie-break. Superseded entries (a node improved after
 *  being pushed, or already expanded) are handled by LAZY deletion: a node's best entry always pops
 *  first (g only ever decreases, and each decrease pushes a strictly better entry), so any later
 *  pop of that node is stale and skipped via `seen`. O(log n) per operation. */
class NodeHeap {
  private fs: number[] = [];
  private is: number[] = [];
  get size(): number { return this.fs.length; }
  private less(a: number, b: number): boolean {
    const fa = this.fs[a]!, fb = this.fs[b]!;
    return fa < fb || (fa === fb && this.is[a]! < this.is[b]!);
  }
  push(f: number, i: number): void {
    const fs = this.fs, is = this.is;
    let c = fs.length;
    fs.push(f); is.push(i);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!this.less(c, p)) break;
      const tf = fs[c]!; fs[c] = fs[p]!; fs[p] = tf;
      const ti = is[c]!; is[c] = is[p]!; is[p] = ti;
      c = p;
    }
  }
  /** Pops the (f, i) minimum and returns i. Caller guarantees non-empty. */
  pop(): number {
    const fs = this.fs, is = this.is;
    const top = is[0]!;
    const lf = fs.pop()!, li = is.pop()!;
    if (fs.length > 0) {
      fs[0] = lf; is[0] = li;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1, r = l + 1;
        let m = p;
        if (l < fs.length && this.less(l, m)) m = l;
        if (r < fs.length && this.less(r, m)) m = r;
        if (m === p) break;
        const tf = fs[p]!; fs[p] = fs[m]!; fs[m] = tf;
        const ti = is[p]!; is[p] = is[m]!; is[m] = ti;
        p = m;
      }
    }
    return top;
  }
}

/** Directed A* (Manhattan-to-hub heuristic, index tie-break → deterministic) from start to ANY goal cell
 *  over `passable`, preferring existing road. `turnPenalty` adds cost per direction change (the
 *  rectilinear style's long straight streets; 0 keeps the classic obstacle-driven winding — the
 *  penalty is approximate, read off the settled parent direction rather than a (cell,dir) state
 *  space, which is exact enough for road styling and stays deterministic). Returns the path
 *  (incl. start + goal) or null. */
/* A* scratch buffers, shared across calls (not reentrant — the generator is single-
 * threaded and astar never nests). A generation stamp marks which entries belong to
 * the current call, so a new search costs no clearing: ~250 searches per generated
 * map otherwise allocate fresh Maps/Sets over a ~24k-cell grid each. */
let bufCap = 0;
let bufGen = 0;
let gBuf = new Float64Array(0);
let cameBuf = new Int32Array(0);
let markBuf = new Int32Array(0);   // stamp: entry valid iff markBuf[i] === bufGen
let seenBuf = new Int32Array(0);   // stamp: settled iff seenBuf[i] === bufGen

function ensureAstarBuffers(cells: number): void {
  if (cells <= bufCap) return;
  bufCap = cells;
  gBuf = new Float64Array(cells);
  cameBuf = new Int32Array(cells);
  markBuf = new Int32Array(cells);
  seenBuf = new Int32Array(cells);
  bufGen = 0;
}

function astar(start: MacroCoord, goals: Set<number>, passable: (x: number, y: number) => boolean, W: number, H: number, road: Set<number>, center: MacroCoord, maxNodes: number, turnPenalty: number): MacroCoord[] | null {
  const si = start.y * W + start.x;
  if (goals.has(si)) return [start];
  ensureAstarBuffers(W * H);
  const gen = ++bufGen;
  const h = (i: number): number => (Math.abs((i % W) - center.x) + Math.abs(((i / W) | 0) - center.y)) * TUNING.roadReuseCost;
  gBuf[si] = 0; cameBuf[si] = -1; markBuf[si] = gen;
  const open = new NodeHeap();
  open.push(h(si), si);
  let guard = 0;
  while (open.size) {
    const cur = open.pop();
    if (seenBuf[cur] === gen) continue; // stale heap entry — this node's best entry already popped
    if (guard++ >= maxNodes) return null;
    if (goals.has(cur)) return reconstruct(cur, gen, W);
    seenBuf[cur] = gen;
    const gcur = markBuf[cur] === gen ? gBuf[cur]! : Infinity;
    const x = cur % W, y = (cur / W) | 0;
    const pi = markBuf[cur] === gen ? cameBuf[cur]! : -1; // settled parent → the direction the path enters `cur` with
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (!passable(nx, ny)) continue;
      const ni = ny * W + nx;
      if (seenBuf[ni] === gen) continue;
      const turn = turnPenalty > 0 && pi >= 0 && ni - cur !== cur - pi ? turnPenalty : 0;
      const ng = gcur + (road.has(ni) ? TUNING.roadReuseCost : TUNING.roadCost) + turn;
      const known = markBuf[ni] === gen ? gBuf[ni]! : Infinity;
      if (ng < known) { cameBuf[ni] = cur; gBuf[ni] = ng; markBuf[ni] = gen; open.push(ng + h(ni), ni); }
    }
  }
  return null;
}

function reconstruct(end: number, gen: number, W: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  let c = end;
  while (c >= 0 && markBuf[c] === gen) { out.push({ x: c % W, y: (c / W) | 0 }); c = cameBuf[c]!; }
  return out.reverse();
}
