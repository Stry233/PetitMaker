import type { GridState, PlacedObject } from '../../../core/model/types';
import type { RoadLookup } from '../../../core/model/road-lookup';
import { isCoatingItem, isSurfacePrint } from '../../../core/model/traits';
import { getCatalogItem } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { updateRoadRegions, type RoadRegion } from './region';

/** The tiles that make up connected road surfaces: base-layer coatings, prints excluded. */
export function roadSurfaceTiles(state: GridState): PlacedObject[] {
  const out: PlacedObject[] = [];
  for (const obj of state.objects.values()) {
    const item = getCatalogItem(obj.catalogId);
    if (isCoatingItem(item) && !isSurfacePrint(item)) out.push(obj);
  }
  return out;
}

/**
 * A road ghost's surface: `tiles` on a copy of `live` holding them and the map's road tiles beside
 * them, so a ghost tile joining a road draws joined rather than as an end, the lookup it reads (its
 * own tiles first, then the map's roads, for the cuts of the tiles at its edge), and those
 * neighbours, whose part of the surface draws again in their own art (which phases at the map
 * origin) and never takes a refused ghost's tint.
 */
export function roadGhost(
  live: GridState, tiles: readonly PlacedObject[], version: number,
): { state: GridState; roads: RoadLookup; beside: PlacedObject[] } {
  const map = roadLookup(live);
  const objects = new Map(tiles.map((t) => [t.id, t]));
  for (const t of tiles) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const beside = map(t.position.x + dx, t.position.y + dy);
      if (beside && !objects.has(beside.id)) objects.set(beside.id, beside);
    }
  }
  const state = { ...live, objects, objectsVersion: version };
  const own = roadLookup(state);
  const beside = [...objects.values()].slice(tiles.length);
  return { state, roads: (x, y) => own(x, y) ?? map(x, y), beside };
}

/** The road fields a region's outline reads. */
const roadPrint = (o: PlacedObject): string =>
  `${o.catalogId}|${o.position.x},${o.position.y}|${o.elevation}|${o.rotation}|${o.corners?.join('') ?? ''}|${o.patchOnly ? 1 : 0}`;

/**
 * The road regions a view last built, re-derived only near the road tiles whose outline fields
 * changed since: each tile's print is compared with the previous build's, so the cache needs no
 * edit events and serves any state of the same template.
 */
export class RoadRegionCache {
  private regions: RoadRegion[] | null = null;
  private prints = new Map<string, { print: string; cell: number }>();
  private template: GridState['template'] | null = null;

  regionsFor(state: GridState, roadObjs: readonly PlacedObject[], roads: RoadLookup): RoadRegion[] {
    const width = state.template.width;
    const prints = new Map<string, { print: string; cell: number }>();
    for (const o of roadObjs) prints.set(o.id, { print: roadPrint(o), cell: o.position.y * width + o.position.x });
    let dirty: Set<number> | null = null;
    if (this.regions && this.template === state.template) {
      dirty = new Set();
      for (const [id, now] of prints) {
        const was = this.prints.get(id);
        if (was?.print === now.print) continue;
        dirty.add(now.cell);
        if (was) dirty.add(was.cell);
      }
      for (const [id, was] of this.prints) if (!prints.has(id)) dirty.add(was.cell);
    }
    this.regions = updateRoadRegions(dirty ? this.regions : null, dirty, roadObjs, roads, width);
    this.prints = prints;
    this.template = state.template;
    return this.regions;
  }
}
