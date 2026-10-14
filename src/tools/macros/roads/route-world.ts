/** Each map owns its versioned routing cache; only road style also depends on pointer location. */
import { mapVersionKey } from '../../../core/model/grid-model';
import { terrainCellsUnder } from '../../../core/grid/footprint';
import { isCoatingItem, isSurfacePrint, isCrossing } from '../../../core/model/traits';
import { type GridState, type MacroCoord } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { objectRect } from '../../../state/object-geometry';
import { analyzeTerrain } from '../../placement/analysis';
import { crossingExitCells } from './network';
import { forEachFootprintCell } from '../../placement/object';
import { scanRoutePortals } from './route-portals';
import { readRoadStyle } from './road-style';
import type { RouteWorld } from './route';
import type { MacroContext } from '../context';
import { cellKey, mapGrid } from '../../../core/grid/rect';

/** Everything but `style` — the part that only depends on the map's own versions + region, so it
 *  is the part worth remembering between calls. */
type CachedWorld = Omit<RouteWorld, 'style'>;
const cache = new WeakMap<GridState, { key: string; world: CachedWorld }>();

function regionKey(region?: readonly MacroCoord[]): string {
  if (!region || region.length === 0) return '';
  return region.map(c => cellKey(c.x, c.y)).join(';');
}

export function routeWorld(
  ctx: MacroContext, opts: { seed: number; region?: readonly MacroCoord[]; near?: MacroCoord },
): RouteWorld {
  const { state } = ctx;
  const key = `${mapVersionKey(state)}|${regionKey(opts.region)}`;
  // Style depends on `near`, so read it from the live state even when the structural cache hits.
  const style = readRoadStyle(state, opts.near);

  const hit = cache.get(state);
  if (hit && hit.key === key) return { ...hit.world, style };

  const analysis = analyzeTerrain(state, opts.region ? [...opts.region] : null);
  const { portals, regionAdj } = scanRoutePortals(ctx, analysis);

  const W = analysis.width, H = analysis.height;
  const { inB } = mapGrid(W, H);
  // Margin-matched to `analyzeTerrain`'s own occupancy read (`buildObjectOccupancy`'s ±0.5
  // micro-grid shift), not the tight integer footprint: an object's real/render footprint bleeds
  // half a cell past its stored rect (the same dual-grid offset the flat trait's own margin exists
  // for), so `a.open` already excludes a cell or two beyond an object's nominal rect. Tracking only
  // the tight rect here would leave those extra cells excluded from `open` yet absent from
  // `occupied` too — impassable under both the strict and the allow-occupied pass, a dead cell no
  // route can ever cross or report as blocked.
  const occupied = new Set<number>(), road = new Set<number>();
  // A bridge is a road, so a deck already standing is somewhere the route may go. It stays in
  // `occupied` (nothing is laid on it and nothing about it is touched) and is named in `deck` as
  // well, which is what tells the planner the difference between a way across and a thing in the
  // way. The two entrances ride along: they are ordinary ground the route paves, and without them
  // the pavement stops at whatever cell the shore erosion left open — a road that ends beside a
  // bridge rather than on it.
  const deck = new Set<number>();
  for (const o of state.objects.values()) {
    const item = getCatalogItem(o.catalogId);
    if (isSurfacePrint(item)) continue;
    const coating = isCoatingItem(item);
    if (coating) forEachFootprintCell(o, (x, y) => road.add(y * W + x));
    if (o.locked) continue;
    if (coating) continue;
    const r = objectRect(o);
    for (const { x, y } of terrainCellsUnder(r)) if (inB(x, y)) occupied.add(y * W + x);
    if (!isCrossing(item)) continue;
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
      if (inB(x, y)) deck.add(y * W + x);
    }
    const [exitA, exitB] = crossingExitCells(o);
    for (const c of [...exitA, ...exitB]) if (inB(c.x, c.y)) deck.add(c.y * W + c.x);
  }

  const world: CachedWorld = { a: analysis, portals, regionAdj, road, occupied, deck };
  cache.set(state, { key, world });
  return { ...world, style };
}
