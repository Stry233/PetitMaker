/**
 * `roads`: connect what is already standing on a live map with the shared router
 * (`scanPortals` + `buildNetwork`).
 *
 * Node derivation: `road-paving.ts:standingNodes` — hub = the locked plaza when there is one, else
 * the centroid of the largest open region SNAPPED into that region (shared with `road-link` so the
 * two macros keep one hub). A region that wraps relief is a
 * ring, and a ring's centroid sits in the hole: on a hilltop plateau of its own, or on slope
 * belonging to no region at all. `setupNet` seeds the whole network on the hub cell, so an unsnapped
 * hub strands every route on ground nothing else can reach and the run lays nothing.
 *
 * `scanPortals` mutation-safety: each portal candidate is validated with a paired, synchronous
 * `tryPlace` + `removePlaced`, so the scan's net state change is zero. Only the roads and crossings
 * `buildNetwork` chooses stick.
 *
 * PRESSING AGAIN OFFERS ANOTHER CANDIDATE, and does it by taking its own last one back rather than
 * by adding to it (`replace`, and `NetworkOptions.variation` for the seed the router's shaping
 * decisions read). The two halves are separate: the seed alone would stack a second
 * network on the first, and the take-back alone would hand back the same network every time.
 *
 * The body runs INSIDE the caller's stroke group and pushes no provenance of its own (see patch.ts).
 */
import {
  ItemCategory, TerrainType,
  type AutoEdgeCut, type GridState, type MacroCoord, type PlacedObject,
} from '../../core/model/types';
import { getCatalogItem, getPlaceableByCategory } from '../../state/catalog';
import { getObjectIndex, objectAt } from '../../state/object-index';
import { objectRect } from '../../state/object-geometry';
import { removeObjectCommand } from '../objects/object-placer';
import { analyzeTerrain, type PlacementAnalysis } from '../placement/analysis';
import { buildNetwork, type Node } from '../placement/network';
import { buildingGate, hasGate, makeCtx, type PlaceCtx } from '../placement/object';
import { readRoadStyle } from '../placement/road-style';
import { scanPortals } from '../placement/portals';
import type { MacroContext } from './context';
import type { MacroRefusal } from './run';
import { objectsChanged } from './measure';
import { floodFrom, networkCells } from './walkable';
import { beautifyRoads, ensureGateTerminals, ringCells, standingNodes, widenRoads } from './road-paving';

/** The router's `settlement` knob. The macro connects what is there rather than sizing a village,
 *  so it runs at the generator's own midpoint and lets the node list decide the extent. */
const SETTLEMENT = 0.5;

/** Candidate crossing sites kept per region pair. Generation's own cap is 2 and the cap is taken in
 *  SCAN order, so with it a seed has almost nothing to choose between: every press on the terraced
 *  fixture ramped at the same twelve points. A wider pool is what lets `network-variation`'s
 *  ordering put a different site first, and the sites are `portalMinSeparation` apart, so they are
 *  genuinely different places to cross rather than neighbours. */
const PRESS_PORTALS_PER_PAIR = 8;

export interface RoadNetworkInput {
  seed: number;
  /** Catalog id of the road tile to pave with; the map's own learned style (else the pool's first
   *  entry) when absent or unknown. */
  material?: string;
  /** How many cells wide the paved routes come out; 1 (the router's own gauge) when absent.
   *  Widening is a dilation pass over what the router laid — each paved cell grows into a
   *  width-sized block, validated tile by tile, so a widening that meets water or a building
   *  simply stops at it. */
  width?: number;
  /** Confine the run to these cells (the placeable mask, so nodes, portals and routes all stay
   *  inside). Whole map when absent. */
  region?: MacroCoord[];
  /** The corner-trim kind the beautifier runs at, from the live Auto Trim setting. `'off'` (or
   *  absent) is a no-op. */
  trim?: AutoEdgeCut;
  /**
   * Ids an EARLIER press of this gesture laid, which this one may take back before laying its own.
   *
   * A press hands another candidate rather than adding to the last one, and the only way to do that
   * without touching a hand's work is for the press to know what its own work WAS. An id list is
   * that knowledge and it cannot be wrong in the way a provenance read can: the ledger answers null
   * for a map loaded without one, so authorship would spare nothing on exactly the maps this feature
   * was asked for. Anything not in this list is somebody else's, including a road the user painted.
   *
   * SCOPED THE SAME WAY THE RUN IS. With `region` painted, only the recorded objects standing inside
   * it come back: a press confined to one corner must not strip the streets on the far side of the
   * map, which is what an unscoped take-back would do the moment a region was painted after a
   * whole-map press.
   */
  replace?: readonly string[];
}

/** What the router did, and where it got to when that was nothing. */
export interface RoadNetworkResult {
  /** Objects the run changed: roads and crossings laid, plus anything the clearance sweep took out
   *  for them. */
  laid: number;
  /** Everything this GESTURE's work now amounts to: what this run laid, plus what `replace` named
   *  and this run did not take back (an id outside a painted region, or one whose object a hand has
   *  since removed). The caller keeps it and hands it to the next press, so the list tracks the
   *  gesture rather than the run. */
  ownedIds: string[];
  /** Why nothing was laid. THREE different situations reach zero and they need three different
   *  answers: a map with nothing on it to join (`code` absent, falls back to `nothing-to-connect`);
   *  every doorstep already meeting the network (`already-connected`: this IS the plan); and
   *  doorsteps found but no open ground between them (`unrouted`). Told apart here because only
   *  here is the node list in hand. */
  reason?: string;
  /** The refusal this is, for a shell that narrates by kind rather than by sentence
   *  (`already-connected` when every hamlet already reaches the network: this IS the plan, not a
   *  routing failure; `unrouted` when doorsteps stand but nothing walkable joins them;
   *  `door-unreachable` when a house the run connected has no gate cell that will take a tile;
   *  `stranded` when the run laid a network and a building stands where it cannot reach). The last
   *  two ride alongside a run that DID lay a network. Absent where the generic `nothing-to-connect`
   *  fallback is the only honest answer this run has. */
  code?: MacroRefusal;
  /** Where the report stands when it is about ONE place: the gate strip of the door left unpaved. */
  at?: MacroCoord;
  /** How many cells the width dilation wanted to pave but left bare because a planting stood there
   *  (nothing standing is ever swept for a road — see `widenRoads`). Present only when > 0, so a
   *  caller that DID lay a network can still say the corridor narrowed around someone's planting
   *  rather than silently swallowing the gap. */
  narrowedByPlanting?: number;
}

/** A WALKABILITY flood, not a road-connectivity one: ONE `networkReach`-shaped BFS over the state as
 *  it stands, seeded from every coated cell plus the hub, expanding over open ground, pavement and
 *  crossing decks alike (unlike the router's own internal `passable`, which treats a standing road as
 *  occupied while it builds — see `network.ts:setupNet`). The decks are in it because a house served
 *  over a ramp is served: reading a deck as a wall reported `unrouted` for a hillside map that was
 *  already finished, which is a re-press claiming it found no way across the very ramp it built.
 *
 *  Two questions read it: whether every hamlet is already served, and which houses this run actually
 *  connected (so a gate terminal is asserted for those and not for a house on ground the run never
 *  reached, whose doorstep tile would be pavement leading nowhere). */
function walkableReach(
  analysis: PlacementAnalysis, place: PlaceCtx, decks: ReadonlySet<number>, hub: Node,
): Uint8Array {
  const { width: W, height: H } = analysis;
  const passable = (i: number): boolean => analysis.open[i] === 1 || place.roads.has(i) || decks.has(i);
  return floodFrom([hub.pos.y * W + hub.pos.x, ...place.roads], passable, W, H);
}

/** Whether every hamlet node the run found is already reachable from the network. Sound for a run
 *  that laid nothing: a hamlet walkably reachable and NOT already served would have had a spur paved
 *  by `network.ts:setupNet`'s `linkToNetwork`, which lays a tile on every walkable path cell, so
 *  "reached" here does mean "already the plan". */
function allHamletsReached(reach: Uint8Array, W: number, nodes: readonly Node[]): boolean {
  const hamlets = nodes.filter((n) => n.kind === 'hamlet');
  return hamlets.every((n) => reach[n.pos.y * W + n.pos.x] === 1);
}

/** Every unlocked building on the map that HAS a door (`hasGate`: a Building of 2x2 or more), with
 *  the cell a road is supposed to meet it at. */
function gatedBuildings(state: GridState, W: number, H: number): { obj: PlacedObject; approach: MacroCoord }[] {
  const out: { obj: PlacedObject; approach: MacroCoord }[] = [];
  for (const obj of state.objects.values()) {
    if (obj.locked) continue;
    const item = getCatalogItem(obj.catalogId);
    if (!item || !hasGate(item)) continue;
    const { approach } = buildingGate(objectRect(obj), obj.rotation);
    if (approach.x < 0 || approach.y < 0 || approach.x >= W || approach.y >= H) continue;
    out.push({ obj, approach });
  }
  return out;
}

/**
 * A LIVE MAP'S HOUSES ALREADY STAND, and that is what hid every doorstep from the router.
 *
 * `analyzeTerrain`'s placeable mask excludes an object's footprint PLUS the dual-grid margin around
 * it (`buildObjectOccupancy` reads the ±0.5 micro-grid shift), and a gate approach sits exactly in
 * that margin. So `doorSpurs`' first and preferred candidate — the gate approach, the cell the
 * navigation regulation exists to connect at — was never `passable`, every spur fell through to the
 * ring search, and each one stopped at whichever side of the house it first touched. Not one of six
 * hand-placed houses on a real map had pavement in its gate strip after a press. GENERATION never
 * saw this: it analyses the terrain BEFORE it places any building, so the doorstep is open there.
 *
 * A doorstep is where a road belongs, so it is put back into the mask for this run: the approach cell
 * of every standing door, where the ground under it is level buildable land no object covers. Called
 * AFTER the node anchors are taken, because an anchor needs a region and these cells belong to none.
 */
function openDoorsteps(state: GridState, analysis: PlacementAnalysis, doors: readonly MacroCoord[]): void {
  const { width: W } = analysis;
  const idx = getObjectIndex(state);
  for (const c of doors) {
    const i = c.y * W + c.x;
    if (analysis.open[i] === 1 || analysis.grass[i] !== 1) continue;
    const cell = state.cells[c.y]?.[c.x];
    if (!cell || cell.terrain?.type === TerrainType.Water) continue;
    if (objectAt(idx, c)) continue;
    analysis.open[i] = 1;
  }
}

/**
 * TAKE BACK THIS GESTURE'S OWN LAST ANSWER, so the next one is a candidate rather than an addition.
 *
 * Only the ids handed in, and of those only the ones still standing (a hand may have deleted one)
 * and only inside the run's own scope. Returns what was NOT taken back, which the caller carries
 * forward: an id left standing outside a painted region is still this gesture's to take back later.
 */
function takeBackOwnWork(
  ctx: MacroContext, ids: readonly string[], region: MacroCoord[] | undefined,
): { kept: string[]; removed: number } {
  const { state, executor } = ctx;
  const inScope = region ? new Set(region.map((c) => `${c.x},${c.y}`)) : null;
  const kept: string[] = [];
  let removed = 0;
  for (const id of ids) {
    const obj = state.objects.get(id);
    if (!obj) continue;
    if (inScope && !inScope.has(`${obj.position.x},${obj.position.y}`)) { kept.push(id); continue; }
    if (executor.execute(removeObjectCommand(obj)).success) removed += 1; else kept.push(id);
  }
  return { kept, removed };
}

/** Routes a road network over the map (or over `input.region`). */
export function layRoadNetwork(ctx: MacroContext, input: RoadNetworkInput): RoadNetworkResult {
  const { state, executor, registry } = ctx;
  const laid = objectsChanged(state);
  const watermark = executor.getUndoStackSize();
  const standing = new Set(state.objects.keys());
  // BEFORE THE ANALYSIS, because the analysis is what the run is planned against: a map still carrying
  // the last press's pavement reads as a map with nothing left to serve, and the run reports
  // `already-connected` instead of laying the moved road.
  const { kept, removed } = input.replace?.length
    ? takeBackOwnWork(ctx, input.replace, input.region)
    : { kept: [], removed: 0 };
  // A RUN THAT KEEPS NOTHING CHANGES NOTHING, take-back included. Every zero-lay report below goes
  // through here, so the map a refusal leaves behind is the map the press started from: without it
  // a press that stripped its own network and then found no route would report the refusal over a
  // bare map.
  const restoreOwn = (): string[] => {
    executor.rollbackTo(watermark);
    return (input.replace ?? []).filter((id) => state.objects.has(id));
  };
  const analysis = analyzeTerrain(state, input.region ?? null);
  // A surface the CALLER named wins, then the map's own, then the pool's first entry — the same
  // order `road-link` picks a material by, so the two road macros never disagree about what "the
  // map's surface" means. The shell names one only when a hand picked it off the bar
  // (`tileMaterialPicked`), so an untouched bar leaves this run matching what the planet is already
  // paved with. Validated against the pool HERE, once, so `buildNetwork` (via `setupNet`'s own
  // identical fallback) and `widenRoads` below always agree on the same id.
  const roadPool = getPlaceableByCategory(ItemCategory.Road);
  const style = readRoadStyle(state);
  const wanted = input.material ?? style.materialId;
  const materialId = roadPool.find((r) => r.id === wanted)?.id ?? roadPool[0]?.id;
  // `refuse`: a live map's decor was placed by a hand, so the gate/crossing clearance this press
  // reserves goes round it rather than through it (`NetworkOptions.clearance`, `PlaceCtx.sweep`).
  // The map's OWN learned naturalness routes this press, rather than the organic default `makeCtx` falls
  // back to when it is called with no naturalness at all.
  const place = makeCtx(state, (c) => executor.execute(c), registry, input.seed, style.naturalness, 'refuse');
  const { regionAdj } = scanPortals(place, analysis, PRESS_PORTALS_PER_PAIR);

  const { nodes, served } = standingNodes(state, analysis);
  const doors = nodes.filter((n) => n.kind === 'hamlet').length;
  if (nodes.length === 0) {
    return { laid: 0, ownedIds: restoreOwn(), reason: 'found nothing to connect: no building or structure stands on open ground here' };
  }
  const W = analysis.width, H = analysis.height;
  const gated = gatedBuildings(state, W, H);
  openDoorsteps(state, analysis, gated.map((g) => g.approach));

  const before = new Set(state.objects.keys());
  // A live-map press lays what a road tool lays: roads, bridges and ramps, and nothing the user did
  // not ask a road tool for — generation's own roadside tree-lining stays generation's.
  buildNetwork(place, analysis, SETTLEMENT, nodes, regionAdj, materialId,
    { clearance: 'refuse', treeLining: false, scenic: false, standingCrossings: true, variation: input.seed });
  const width = Math.floor(input.width ?? 1);
  let narrowedByPlanting = 0;
  if (width > 1 && materialId) {
    const fresh = [...state.objects.values()]
      .filter((o) => !before.has(o.id) && getCatalogItem(o.catalogId)?.category === ItemCategory.Road);
    narrowedByPlanting = widenRoads(ctx, materialId, width, fresh);
  }
  // GATES ARE THE TERMINALS HERE TOO, and asserted rather than hoped for: `ensureGateTerminals`'
  // own header lists the three ways the router can link a door and still stop short of pavement. The
  // two-tap gesture has always finished them and this one never called it at all. Only the doors the
  // run actually CONNECTED — a house in a pocket nothing reached would otherwise get a lone tile at
  // its doorstep with no street leading to it.
  const hub = nodes.find((n) => n.kind === 'hub');
  const reach = hub ? walkableReach(analysis, place, networkCells(state, W, H).decks, hub) : new Uint8Array(W * H);
  // A HOUSE IS REACHED WHEN THE WALK GETS TO ITS RING, not when it gets to its doorstep. The gate
  // approach sits in the house's own dual-grid margin, so `analysis.open` closes every cell around it
  // and `openDoorsteps` reopens the approach ALONE — a pocket of one open cell the flood cannot
  // enter. Reading reach there answered "no" for every house whose door faces a terrace step, so the
  // run skipped the very doorsteps the rules would have taken a tile on.
  const connected = gated
    .filter((g) => reach[g.approach.y * W + g.approach.x] === 1
      || ringCells(objectRect(g.obj)).some((c) => c.x >= 0 && c.y >= 0 && c.x < W && c.y < H && reach[c.y * W + c.x] === 1))
    .map((g) => g.obj);
  const unreachedDoors = materialId && hub
    ? ensureGateTerminals(ctx, place, materialId, connected).unreached
    : [];
  // The beautifier, on every fresh road cell (the router's own paving plus the widen's dilation),
  // exactly as `road-link` runs it: a smart press has always laid square corners while a brush
  // stroke beside it got them cut, which read as two different road tools.
  const allFresh = [...state.objects.values()]
    .filter((o) => !before.has(o.id) && getCatalogItem(o.catalogId)?.category === ItemCategory.Road)
    .map((o) => o.position);
  beautifyRoads(ctx, allFresh, input.trim ?? 'off');

  // A DOOR THE RUN COULD NOT FINISH IS NAMED, whether or not the rest of the network landed: it is
  // the most specific thing this run has to say, and the only one that is about one place.
  const door: Pick<RoadNetworkResult, 'code' | 'at'> = unreachedDoors.length > 0
    ? { code: 'door-unreachable', at: unreachedDoors[0]! }
    : {};

  const fresh = [...state.objects.keys()].filter((id) => !standing.has(id));
  // THE TAKE-BACK IS UNDONE RATHER THAN LEFT STANDING when the run that asked for it built nothing.
  // `changed` counts departures as well as arrivals, so a stripped map with no new network would
  // otherwise read as a few hundred changes of success.
  if (removed > 0 && fresh.length === 0) {
    return {
      laid: 0, ownedIds: restoreOwn(), code: 'unrouted',
      reason: 'took the last plan back and found no way to lay another, so the last plan stands',
    };
  }

  const changed = laid();
  if (changed > 0) {
    // A BUILDING THE NETWORK NEVER REACHED IS NAMED TOO, and named FIRST: it is the larger fact.
    // `door-unreachable` is a house the run DID connect whose gate strip takes no tile, so it only
    // ever speaks of connected houses — without this a building on ground nothing routes to would be
    // dropped in silence while the press reports a few hundred tiles of success.
    const stranded = nodes.find((n) => n.kind === 'hamlet' && reach[n.pos.y * W + n.pos.x] !== 1);
    const report: Pick<RoadNetworkResult, 'code' | 'at'> = stranded ? { code: 'stranded', at: stranded.pos } : door;
    return { laid: changed, ownedIds: [...kept, ...fresh], ...report, ...(narrowedByPlanting > 0 ? { narrowedByPlanting } : {}) };
  }
  if (door.code) {
    return { laid: 0, ownedIds: restoreOwn(), ...door, reason: 'a doorway here has no cell that will take a road tile' };
  }
  // ALREADY CONNECTED, in the plainest form there is: nothing is left wanting a road because the
  // network already touches everything that could want one. A map with only a hub and nothing else
  // standing is the OTHER zero, and says so.
  //
  // A CALLER WITH A `replace` LIST NEVER ARRIVES HERE over its own network, and that is the point of
  // the list: it took that network back above, so what remains is a map full of buildings wanting a
  // road and the run lays another candidate. This report is for the caller that has no list to hand
  // — a press after a reload, the agent's director tool — where "the network already touches
  // everything" is still the whole truth.
  if (doors === 0) {
    return served > 0
      ? { laid: 0, ownedIds: restoreOwn(), code: 'already-connected', reason: 'every building here already meets the network: this is the plan, nothing to add' }
      : { laid: 0, ownedIds: restoreOwn(), reason: 'found only the hub to connect: nothing else stands on open ground here' };
  }
  // Every hamlet this run found is already reachable from the (unchanged) network — the plan, not a
  // failure to find one. The only honest way to tell that apart from a map the router cannot route
  // across.
  if (hub && allHamletsReached(reach, W, nodes)) {
    return { laid: 0, ownedIds: restoreOwn(), code: 'already-connected', reason: 'every building here already meets the network: this is the plan, nothing to add' };
  }
  return {
    laid: 0,
    ownedIds: restoreOwn(),
    code: 'unrouted',
    reason: `found ${doors} doorstep(s) to connect but no open ground to route between them`,
  };
}
