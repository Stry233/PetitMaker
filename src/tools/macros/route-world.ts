/**
 * The map as `route.ts` reads it: analysis, validated crossing sites, the standing roads and the
 * learned style, assembled once and handed to `planRoute`/`routeOffers` as pure data.
 *
 * Built on a DETACHED CLONE, because `scanPortals` proves each candidate by placing a crossing and
 * taking it back again and a live map must not be written to for a question — a
 * caller may hand this the LIVE `MacroContext` directly (the route ghost does, to answer a pointer
 * question without running the whole macro build).
 *
 * MEMOIZED ON THE MAP'S OWN VERSION COUNTERS, one slot per `GridState`. The scan is two full-grid
 * passes with a dry-run placement per candidate, and the route ghost asks a question per pointer
 * cell: without this the first hover would cost what the whole roads macro costs and every hover
 * after it would pay again for an answer that cannot have changed.
 *
 * Keyed by the STATE OBJECT ITSELF (a `WeakMap`), not merely its version numbers: two DIFFERENT
 * maps can both read `cellsVersion`/`objectsVersion` as 0 (a freshly generated or loaded map, or
 * two of this module's own test fixtures), and a plain version-string key would then hand one
 * map's scan to the other's question. A `WeakMap` also means an abandoned clone (the preview's own,
 * built once and dropped) is never kept alive by this cache — the two live slots the design wants
 * (the gesture's own map, the preview's clone) fall out for free, one per state, with no eviction
 * bookkeeping at all.
 *
 * `style` RIDES OUTSIDE THE CACHED SLOT. `readRoadStyle`'s "nearest standing street" reading is a
 * function of `near` (`road-style.ts:nearestMaterial`), which changes on every tap/hover without
 * moving either version counter — caching it under a key that doesn't carry `near` would answer a
 * second call's different `near` with the first call's material. It is cheap relative to the scan
 * (one pass over `state.objects`, not a portal dry-run), so it is simplest to just never cache it:
 * read fresh off the LIVE `state` every call, hit or miss. That is safe even on a cache HIT — the
 * hit only fires when `state`'s own versions match the cached key, so its objects are, by
 * construction, exactly what they were when the rest of the world was built.
 */
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { cellOverlapsRect, cloneGridState } from '../../core/model/grid-model';
import { ItemCategory, type EditorEvents, type GridState, type MacroCoord } from '../../core/model/types';
import { getCatalogItem } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import { roadLookup } from '../../state/object-index';
import { analyzeTerrain } from '../generation/placement/analysis';
import { crossingExitCells } from '../generation/placement/network';
import { makeCtx } from '../generation/placement/object';
import { scanPortals } from '../generation/placement/portals';
import { readRoadStyle } from '../generation/placement/road-style';
import type { RouteWorld } from '../generation/placement/route';
import type { MacroContext } from './context';

/** An AIMED route CHOOSES a crossing by where its two taps are, so it needs candidates ALONG the
 *  whole seam between two regions rather than the handful generation's cheap spanning tree keeps.
 *  The cap is taken in scan order, so a small one is not a sample of a river: with four kept, every
 *  candidate for a north-south region pair sat in the island's north, and a route between two
 *  southern taps walked fifteen cells up to one of them and twenty back. The scan this pays for runs
 *  once per map version and is then cached. */
const ROUTE_PORTALS_PER_PAIR = 32;

/** Everything BUT `style` — the part that only depends on the map's own versions + region, so it
 *  is the part worth remembering between calls. */
type CachedWorld = Omit<RouteWorld, 'style'>;
const cache = new WeakMap<GridState, { key: string; world: CachedWorld }>();

function regionKey(region?: readonly MacroCoord[]): string {
  if (!region || region.length === 0) return '';
  const first = region[0]!, last = region[region.length - 1]!;
  return `${region.length}|${first.x},${first.y}|${last.x},${last.y}`;
}

export function routeWorld(
  ctx: MacroContext, opts: { seed: number; region?: readonly MacroCoord[]; near?: MacroCoord },
): RouteWorld {
  const { state } = ctx;
  const key = `${state.cellsVersion ?? 0}|${state.objectsVersion ?? 0}|${regionKey(opts.region)}`;
  // Read fresh every call — see the file header. Off the LIVE state, not the (possibly not-yet-
  // built) clone: on a cache hit there is no clone at all, and `state`'s objects already equal
  // what the clone would hold whenever the version-keyed hit fires.
  const style = readRoadStyle(state, opts.near);

  const hit = cache.get(state);
  if (hit && hit.key === key) return { ...hit.world, style };

  const clone = cloneGridState(state);
  const executor = new CommandExecutor(clone, new EventBus<EditorEvents>(), ctx.registry, roadLookup(clone));
  const place = makeCtx(clone, (c) => executor.execute(c), ctx.registry, opts.seed);
  const analysis = analyzeTerrain(clone, opts.region ? [...opts.region] : null);
  const { portals, regionAdj } = scanPortals(place, analysis, ROUTE_PORTALS_PER_PAIR);

  const W = analysis.width, H = analysis.height;
  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  // `place.roads` is every coated cell on the clone (`makeCtx` seeds it), which is exactly what a
  // route may cheaply reuse. The rest of the unlocked, non-coating footprint is what it must go
  // AROUND — a coating is never "occupied" here, or a route reusing a standing street would read
  // its own reused cells as blocked.
  //
  // MARGIN-MATCHED TO `analyzeTerrain`'s OWN occupancy read (`buildObjectOccupancy`'s ±0.5
  // micro-grid shift), not the tight integer footprint: an object's real/render footprint bleeds
  // half a cell past its stored rect (the same dual-grid offset the flat trait's own margin exists
  // for), so `a.open` already excludes a cell or two beyond an object's nominal rect. Tracking only
  // the tight rect here would leave those extra cells excluded from `open` yet absent from
  // `occupied` too — impassable under BOTH the strict AND the allow-occupied pass, a dead cell no
  // route can ever cross or report as blocked.
  const occupied = new Set<number>();
  // A BRIDGE IS A ROAD, so a deck already standing is somewhere the route may GO. It stays in
  // `occupied` (nothing is laid on it and nothing about it is touched) and is named in `deck` as
  // well, which is what tells the planner the difference between a way across and a thing in the
  // way. The two ENTRANCES ride along: they are ordinary ground the route paves, and without them
  // the pavement stops at whatever cell the shore erosion left open — a road that ends beside a
  // bridge rather than on it.
  const deck = new Set<number>();
  for (const o of clone.objects.values()) {
    if (o.locked) continue;
    const item = getCatalogItem(o.catalogId);
    if (item?.category === ItemCategory.Road) continue;
    const r = objectRect(o);
    const x0 = Math.floor(r.x - 0.5), x1 = Math.ceil(r.x + r.w + 0.5);
    const y0 = Math.floor(r.y - 0.5), y1 = Math.ceil(r.y + r.h + 0.5);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (inB(x, y) && cellOverlapsRect(r, x, y, -0.5)) occupied.add(y * W + x);
    }
    if (item?.category !== ItemCategory.Bridge && item?.category !== ItemCategory.Ramp) continue;
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
      if (inB(x, y)) deck.add(y * W + x);
    }
    const [exitA, exitB] = crossingExitCells(o);
    for (const c of [...exitA, ...exitB]) if (inB(c.x, c.y)) deck.add(c.y * W + c.x);
  }

  const world: CachedWorld = { a: analysis, portals, regionAdj, road: place.roads, occupied, deck };
  cache.set(state, { key, world });
  return { ...world, style };
}
