/**
 * `road-link`: one route between two points, chosen from up to three drafted offers
 * (`route-offers.ts`), and it connects them or lays nothing — the pavement is stitched into one piece
 * after the crossings land where the traits snapped them, and a route that still cannot be joined
 * takes itself back and says where it stopped. A point on a building resolves to its entrance.
 */
import type { MacroCoord, PlacedObject } from '../../../core/model/types';
import { type AutoEdgeCut } from '../../../state/editing/vocabulary';
import { clamp } from '../../../core/base/math';
import { getCatalogItem, getPlaceableWhere, roleOf } from '../../../state/catalog';
import { getObjectIndex, objectAt } from '../../../state/object-index';
import { objectRect } from '../../../state/object-geometry';
import { approachCells } from './network';
import { hasGate, openAt, sweepClearanceCells, tryPlace, type PlaceCtx } from '../../placement/object';
import { crossingEndClearance, crossingPool, mainCrossingId } from '../../placement/crossings';
import { gateTerminalCells, type RoutePlan, type RouteWorld } from './route';
import { routeOffers } from './route-offers';
import type { Portal } from './portals';
import { objectsChanged } from '../runtime/measure';
import { beautifyRoads, ensureGateTerminals, joinRoute, paveCells, widenRoads } from './road-paving';
import { routeWorld } from './route-world';
import type { MacroContext } from '../context';
import type { MacroReport } from '../run';
import { isCoating, isCoatingItem } from '../../../core/model/traits';
import { mapGrid } from '../../../core/grid/rect';

interface RoadLinkInput {
  seed: number;
  /** Destination; a building resolves to its entrance, like `from`. */
  to: MacroCoord;
  from: MacroCoord;
  offer?: number;
  material?: string;
  width?: number;
  region?: MacroCoord[];
  trim?: AutoEdgeCut;
}

interface RoadLinkResult {
  laid: number;
  report: MacroReport;
}

const MAX_CROSSING_RETRIES = 12;

/** Where a route meets a building: a real house's gate approach (`hasGate`), else the nearest open
 *  cell of its footprint's ring — the same fallback `roads.ts`'s hamlet-node derivation uses for a
 *  gateless stall. */
function entranceOf(world: RouteWorld, building: PlacedObject): MacroCoord | null {
  const item = getCatalogItem(building.catalogId)!;
  const rect = objectRect(building);
  if (hasGate(item)) return gateTerminalCells(rect, building.rotation)[0]!;
  const cells = approachCells(rect, world.a, world.a.width, world.a.height, world.occupied as Set<number>);
  return cells.find((c) => openAt(world.a, c.x, c.y)) ?? null;
}

/** Retain a validated site's catalog geometry; an unbound portal uses the catalog fallback order. */
function realizeCrossing(place: PlaceCtx, p: Portal): PlacedObject | null {
  if (p.catalogId) return tryPlace(place, p.catalogId, p.anchor.x, p.anchor.y);
  const pool = crossingPool(p.kind);
  const main = mainCrossingId(p.kind);
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
  const { inB } = mapGrid(W, H);
  const failed: MacroCoord[] = [];
  const placed: PlacedObject[] = [];
  for (const p of crossings) {
    const obj = realizeCrossing(place, p);
    if (!obj) { failed.push(p.anchor); continue; }
    placed.push(obj);
    const ends3 = new Set<number>();
    for (const c of crossingEndClearance(obj)) if (inB(c.x, c.y)) ends3.add(c.y * W + c.x);
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
  const savepoint = executor.beginStroke();
  const pool = getPlaceableWhere(isCoating);
  const roadId = input.material ?? world.style.materialId ?? pool[0]?.id;
  if (!roadId) return { laid: 0, report: {} };

  const gateBuildings: PlacedObject[] = [];
  const idx = getObjectIndex(state);
  const endpoint = (at: MacroCoord): MacroCoord | null => {
    const obj = objectAt(idx, at);
    if (!obj || roleOf(obj) !== 'home') return at;
    if (!gateBuildings.some(b => b.id === obj.id)) gateBuildings.push(obj);
    return entranceOf(world, obj);
  };
  const from = endpoint(input.from), to = endpoint(input.to);
  if (!from || !to) return { laid: 0, report: { code: 'no-route' } };
  const offers = routeOffers(world, from, to);
  if (offers.length === 0) return { laid: 0, report: { code: 'no-route' } };
  const offerNames = offers.map(o => o.profile);
  const plan: RoutePlan = offers[clamp(Math.floor(input.offer ?? 0), 0, offers.length - 1)]!.plan;

  const place: PlaceCtx = {
    state, execute: (c) => executor.execute(c), registry, seed: input.seed,
    naturalness: world.style.naturalness, clearance: new Set(), roads: new Set(world.road),
    // A live-map gesture, not generation: nothing a hand placed is deleted, ever.
    sweep: 'refuse',
  };
  const { placed, failed: failedCrossings } = realizeCrossings(place, plan.crossings);

  const before = new Set(state.objects.keys());
  const laidCells = paveCells(ctx, place, roadId, [...plan.cells, ...plan.pads]);
  // Capture the centerline before adding full-width entrances, which must not be dilated again.
  const freshRoads = [...state.objects.values()].filter((o) => !before.has(o.id) && isCoatingItem(getCatalogItem(o.catalogId)));
  // The realized geometry gets the last word (`joinRoute`): a snapped deck sits where the plan's
  // approach cells are not, and one hole at an entrance is a route in three pieces.
  const join = joinRoute(ctx, place, roadId, {
    a: world.a, turnPenalty: world.style.turnPenalty, crossings: placed, from: plan.from, to: plan.to, width: input.width,
  });
  // A route that did not connect lays nothing. The whole point of the gesture is a road between the
  // two points; pavement that stops on the wrong side of a river is not a smaller version of that,
  // it is something the user now has to undo, and `changes > 0` would tell them it worked. The cause
  // is named where the run knows it: a hand's planting on the only line through is `blocked` (the
  // cells ride along, so the ghost can mark them), anything else is `unjoined`.
  if (join.stoppedAt) {
    savepoint.rollback();
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
        offers: offerNames,
      },
    };
  }
  const narrowed = widenRoads(ctx, roadId, input.width ?? 1, freshRoads);
  const { unreached } = ensureGateTerminals(ctx, place, roadId, gateBuildings);
  if (unreached.length > 0) {
    savepoint.rollback();
    return { laid: 0, report: { code: 'door-unreachable', at: unreached[0] } };
  }

  const allFresh = [...state.objects.values()]
    .filter((o) => !before.has(o.id) && isCoatingItem(getCatalogItem(o.catalogId)))
    .map((o) => o.position);
  beautifyRoads(ctx, [...laidCells, ...join.paved, ...allFresh], input.trim ?? 'off');

  const report: MacroReport = {
    ends: [plan.from, plan.to],
    blocked: [...plan.blocked, ...failedCrossings],
    ...(narrowed > 0 ? { narrowedByPlanting: narrowed } : {}),
    offers: offerNames,
  };
  return { laid: countChanged(), report };
}
