/**
 * `road-link`: ONE ROUTE, or ONE DOOR.
 *
 * `from` present: the route between two points, chosen from up to three drafted offers
 * (`route-offers.ts`), and it CONNECTS THEM OR LAYS NOTHING — the pavement is stitched into one piece
 * after the crossings land where the traits snapped them, and a route that still cannot be joined
 * takes itself back and says where it stopped.
 *
 * `from` absent: the tap landed on a building, and this is that building's door
 * spur to the nearest network point (or to the hub when there is no network yet) — the same
 * `doorSpurs` machinery scoped to one building rather than a second implementation of it. Anything
 * else builds nothing and says why.
 */
import { ItemCategory, type AutoEdgeCut, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { clamp } from '../../core/model/math';
import { categoryOf, getCatalogItem, getPlaceableByCategory } from '../../state/catalog';
import { getObjectIndex, objectAt } from '../../state/object-index';
import { objectRect } from '../../state/object-geometry';
import { bySizeDesc } from '../../core/model/geometry';
import { approachCells } from '../placement/network';
import { hasGate, openAt, sweepClearanceCells, tryPlace, type PlaceCtx } from '../placement/object';
import { crossingEnds } from '../placement/themes';
import { gateTerminalCells, planRoute, type RoutePlan, type RouteWorld } from '../placement/route';
import { routeOffers } from '../placement/route-offers';
import type { Portal } from '../placement/portals';
import { objectsChanged } from './measure';
import { beautifyRoads, ensureGateTerminals, gateAlreadyPaved, hubNode, joinRoute, paveCells, widenRoads } from './road-paving';
import { routeWorld } from './route-world';
import type { MacroContext } from './context';
import type { MacroReport } from './run';

export interface RoadLinkInput {
  seed: number;
  /** Destination. Without `from`, a building target requests a door spur. */
  to: MacroCoord;
  from?: MacroCoord;
  offer?: number;
  material?: string;
  width?: number;
  region?: MacroCoord[];
  trim?: AutoEdgeCut;
}

export interface RoadLinkResult {
  laid: number;
  report: MacroReport;
}

const MAX_CROSSING_RETRIES = 12;

/** The catalogId nearest `head`, ties by lowest flat index — for reaching an ALREADY-standing
 *  network from a spur's own gate. */
function nearestRoadCell(head: MacroCoord, road: ReadonlySet<number>, W: number): MacroCoord | null {
  let best: MacroCoord | null = null, bestDist = Infinity, bestIdx = Infinity;
  for (const i of road) {
    const x = i % W, y = (i / W) | 0;
    const dist = Math.abs(x - head.x) + Math.abs(y - head.y);
    if (dist < bestDist || (dist === bestDist && i < bestIdx)) { best = { x, y }; bestDist = dist; bestIdx = i; }
  }
  return best;
}

/** Where a spur starts: a real house's gate approach (`hasGate`), else the nearest open cell of its
 *  footprint's ring — the same fallback `roads.ts`'s hamlet-node derivation uses for a gateless
 *  stall. */
function spurHead(world: RouteWorld, building: PlacedObject): MacroCoord | null {
  const item = getCatalogItem(building.catalogId)!;
  const rect = objectRect(building);
  if (hasGate(item)) return gateTerminalCells(rect, building.rotation)[0]!;
  const cells = approachCells(rect, world.a, world.a.width, world.a.height, world.occupied as Set<number>);
  return cells.find((c) => openAt(world.a, c.x, c.y)) ?? null;
}

/** Retain a validated site's catalog geometry; an unbound portal uses the catalog fallback order. */
function realizeCrossing(place: PlaceCtx, p: Portal): PlacedObject | null {
  if (p.catalogId) return tryPlace(place, p.catalogId, p.anchor.x, p.anchor.y);
  const pool = p.kind === 'bridge' ? getPlaceableByCategory(ItemCategory.Bridge) : getPlaceableByCategory(ItemCategory.Ramp);
  const main = p.kind === 'bridge' ? [...pool].sort(bySizeDesc)[0]?.id : pool[0]?.id;
  const ids = [...(main ? [main] : []), ...pool.map((c) => c.id).filter((id) => id !== main)];
  for (const id of ids) {
    const obj = tryPlace(place, id, p.anchor.x, p.anchor.y);
    if (obj) return obj;
  }
  return null;
}

/** Earlier crossings may invalidate a later site. Report every refusal and preserve existing
 *  decoration when reserving the approaches of a live-map route. */
function realizeCrossings(place: PlaceCtx, crossings: readonly Portal[]): { placed: PlacedObject[]; failed: MacroCoord[] } {
  const W = place.state.template.width, H = place.state.template.height;
  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const failed: MacroCoord[] = [];
  const placed: PlacedObject[] = [];
  for (const p of crossings) {
    const obj = realizeCrossing(place, p);
    if (!obj) { failed.push(p.anchor); continue; }
    placed.push(obj);
    const ends3 = new Set<number>();
    for (const e of crossingEnds(obj)) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = e.x + dx, y = e.y + dy;
        if (inB(x, y)) ends3.add(y * W + x);
      }
    }
    for (const i of ends3) place.clearance.add(i);
    if (place.sweep !== 'refuse') sweepClearanceCells(place, ends3);
  }
  return { placed, failed };
}

export function layRoadLink(ctx: MacroContext, input: RoadLinkInput): RoadLinkResult {
  return layRoute(ctx, input, routeWorld(ctx, { seed: input.seed, region: input.region, near: input.to }), 0);
}

function layRoute(ctx: MacroContext, input: RoadLinkInput, world: RouteWorld, attempt: number): RoadLinkResult {
  const { state, executor, registry } = ctx;
  const countChanged = objectsChanged(state);
  // Where the run started, so a route that turns out not to connect can take its own pavement back.
  const watermark = executor.getUndoStackSize();
  const pool = getPlaceableByCategory(ItemCategory.Road);
  const roadId = input.material ?? world.style.materialId ?? pool[0]?.id;
  if (!roadId) return { laid: 0, report: {} };

  let plan: RoutePlan | null;
  let offerNames: readonly string[] | undefined;
  let gateBuildings: PlacedObject[] = [];

  if (input.from) {
    const idx = getObjectIndex(state);
    const endpoint = (at: MacroCoord): MacroCoord | null => {
      const obj = objectAt(idx, at);
      if (!obj || categoryOf(obj) !== ItemCategory.Building) return at;
      if (!gateBuildings.some(b => b.id === obj.id)) gateBuildings.push(obj);
      return spurHead(world, obj);
    };
    const from = endpoint(input.from), to = endpoint(input.to);
    if (!from || !to) return { laid: 0, report: { code: 'no-route' } };
    const offers = routeOffers(world, from, to);
    if (offers.length === 0) return { laid: 0, report: { code: 'no-route' } };
    offerNames = offers.map(o => o.profile);
    plan = offers[clamp(Math.floor(input.offer ?? 0), 0, offers.length - 1)]!.plan;
  } else {
    // "Nothing here" — a tap on open ground, or a building whose gate cannot even be located —
    // is `nothing-to-connect`, not the generic no-route message: nothing was wrong with routing,
    // there was nothing to route FROM.
    const building = objectAt(getObjectIndex(state), input.to);
    if (!building || categoryOf(building) !== ItemCategory.Building) return { laid: 0, report: { code: 'nothing-to-connect' } };
    const item = getCatalogItem(building.catalogId);
    // ALREADY CONNECTED: a real house whose gate strip already carries a coating has nothing left
    // for this press to do — THIS is the plan, not a routing failure. Checked before any of the
    // route machinery runs, off the live index, so a re-press over an already-served door reports
    // the true reason instead of `no-route`.
    if (item && hasGate(item) && gateAlreadyPaved(state, objectRect(building), building.rotation)) {
      return { laid: 0, report: { code: 'already-connected' } };
    }
    const head = spurHead(world, building);
    if (!head) return { laid: 0, report: { code: 'nothing-to-connect' } };
    const target = world.road.size > 0 ? nearestRoadCell(head, world.road, world.a.width) : (hubNode(state, world.a)?.pos ?? null);
    if (!target) return { laid: 0, report: { code: 'nothing-to-connect' } };
    plan = planRoute(world, head, target, 'short');
    if (!plan) return { laid: 0, report: { code: 'no-route' } };
    gateBuildings = [building];
  }

  const place: PlaceCtx = {
    state, execute: (c) => executor.execute(c), reg: registry, seed: input.seed,
    naturalness: world.style.naturalness, clearance: new Set(), roads: new Set(world.road),
    // A live-map gesture, not generation: nothing a hand placed is deleted, ever.
    sweep: 'refuse',
  };
  const { placed, failed: failedCrossings } = realizeCrossings(place, plan.crossings);

  const before = new Set(state.objects.keys());
  const laidCells = paveCells(ctx, place, roadId, [...plan.cells, ...plan.pads]);
  // Capture the centerline before adding full-width entrances, which must not be dilated again.
  const freshRoads = [...state.objects.values()].filter((o) => !before.has(o.id) && categoryOf(o) === ItemCategory.Road);
  // THE REALIZED GEOMETRY GETS THE LAST WORD (`joinRoute`): a snapped deck sits where the plan's
  // approach cells are not, and one hole at an entrance is a route in three pieces.
  const join = joinRoute(ctx, place, roadId, {
    a: world.a, turnPenalty: world.style.turnPenalty, crossings: placed, from: plan.from, to: plan.to, width: input.width,
  });
  // A ROUTE THAT DID NOT CONNECT LAYS NOTHING. The whole point of the gesture is a road between the
  // two points; pavement that stops on the wrong side of a river is not a smaller version of that,
  // it is something the user now has to undo, and `changes > 0` would tell them it worked. The cause
  // is named where the run knows it: a hand's planting on the only line through is `blocked` (the
  // cells ride along, so the ghost can mark them), anything else is `unjoined`.
  if (input.from && join.stoppedAt) {
    executor.rollbackTo(watermark);
    if (attempt < MAX_CROSSING_RETRIES && plan.crossings.length) {
      const stop = join.stoppedAt;
      const blockedCrossing = [...plan.crossings].sort((a, b) =>
        Math.abs(a.anchor.x - stop.x) + Math.abs(a.anchor.y - stop.y)
        - Math.abs(b.anchor.x - stop.x) - Math.abs(b.anchor.y - stop.y))[0]!;
      return layRoute(ctx, input, { ...world, portals: world.portals.filter(p => p !== blockedCrossing) }, attempt + 1);
    }
    const blocked = [...plan.blocked, ...failedCrossings];
    return {
      laid: 0,
      report: {
        code: plan.blocked.length > 0 ? 'blocked' : 'unjoined',
        at: join.stoppedAt,
        ...(blocked.length > 0 ? { blocked } : {}),
        ...(offerNames ? { offers: offerNames } : {}),
      },
    };
  }
  const narrowed = widenRoads(ctx, roadId, input.width ?? 1, freshRoads);
  const { unreached } = ensureGateTerminals(ctx, place, roadId, gateBuildings);
  if (input.from && unreached.length > 0) {
    executor.rollbackTo(watermark);
    return { laid: 0, report: { code: 'door-unreachable', at: unreached[0] } };
  }

  const allFresh = [...state.objects.values()]
    .filter((o) => !before.has(o.id) && categoryOf(o) === ItemCategory.Road)
    .map((o) => o.position);
  beautifyRoads(ctx, [...laidCells, ...join.paved, ...allFresh], input.trim ?? 'off');

  const report: MacroReport = {
    ends: [plan.from, plan.to],
    blocked: [...plan.blocked, ...failedCrossings],
    ...(narrowed > 0 ? { narrowedByPlanting: narrowed } : {}),
    ...(offerNames ? { offers: offerNames } : {}),
    ...(unreached.length > 0 ? { code: 'door-unreachable' as const, at: unreached[0] } : {}),
  };
  return { laid: countChanged(), report };
}
