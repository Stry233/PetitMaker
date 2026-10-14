/**
 * Memoized spatial index over GridState.objects, shared by every consumer that
 * asks "which objects are here?". Without it each question is a full scan of the objects Map (with a
 * catalog lookup per entry), and generation/agent strokes ask it millions of
 * times on a decorated map.
 *
 * Freshness: keyed on `state.objectsVersion`, bumped at every object mutation
 * site (command-apply and the placer's temporary self-removal). The size check
 * is a backstop for a missed bump on an add/remove path.
 *
 * Incremental: when the mutation left an `objectsDelta` and this cache is one version behind it,
 * the changed entries are patched in. Anything unexpected (no delta, a skipped version, an
 * unindexed removal, a post-patch count that disagrees with `state.objects`) falls back to a full
 * rebuild, so the index can be slow but never stale.
 *
 * Determinism: entries carry their insertion order (`ord`); every query returns
 * candidates in that order, so consumers see the same object order a full insertion-
 * order scan produced.
 */
import { cellOverlapsRect, chunkKey, cellKey, rectsOverlap, type Rect } from '../core/grid/rect';
import { bucketOf } from '../core/grid/buckets';
import { TERRAIN_GRID_OFFSET } from '../core/grid/grid-convert';
import { PLACEMENT_GRID } from '../core/game/profile';
import type { GridState, MacroCoord, PlacedObject, CatalogItem } from '../core/model/types';
import type { RoadLookup } from '../core/model/road-lookup';
import type { MapPoint } from '../core/grid/grids';
import { getCatalogItem } from './catalog';
import { isCoating, isCoatingItem, isSurfacePrint, coatingLayer } from '../core/model/traits';
import { objectRect } from './object-geometry';

export interface ObjectIndexEntry {
  obj: PlacedObject;
  rect: Rect;
  item: CatalogItem | undefined;
  coating: boolean;
  ord: number;
}

export interface ObjectIndex {
  /** All objects, insertion order. */
  entries: ObjectIndexEntry[];
  /** Non-patch coating (road) object by its "x,y" position. */
  roadByCell: Map<string, PlacedObject>;
  /** Placed count per catalogId. */
  countByCatalog: Map<string, number>;
  /** Entries bucketed by every chunk their rect (padded by the −0.5 terrain
   *  shift) overlaps — the spatial query surface. */
  byChunk: Map<string, ObjectIndexEntry[]>;
  /** Entries bucketed by every macro cell their rect touches — the same surface
   *  one step finer, for the questions that name a footprint rather than a
   *  neighbourhood (`entriesCovering`). A chunk bucket holds BUCKET_SIZE² entries
   *  on a paved map, so answering "what is under this one cell" out of one makes
   *  a road fill quadratic in its own density. */
  byCell: Map<string, ObjectIndexEntry[]>;
  /** Entry by object id — the handle an incremental patch needs to find what a
   *  delta refers to without scanning. */
  byId: Map<string, ObjectIndexEntry>;
}

interface Cached { version: number; size: number; index: ObjectIndex; nextOrd: number }
const cache = new WeakMap<GridState, Cached>();

/** Every chunk key an object's rect touches, padded by the terrain grid's offset so a terrain
 *  cell's overlap query never needs to look past its own chunk range. */
function forEachChunk(rect: Rect, fn: (key: string) => void): void {
  const lo = bucketOf(rect.x + TERRAIN_GRID_OFFSET.x, rect.y + TERRAIN_GRID_OFFSET.y);
  const hi = bucketOf(rect.x + rect.w - TERRAIN_GRID_OFFSET.x, rect.y + rect.h - TERRAIN_GRID_OFFSET.y);
  for (let cy = lo.cy; cy <= hi.cy; cy++) {
    for (let cx = lo.cx; cx <= hi.cx; cx++) fn(chunkKey(cx, cy));
  }
}

/**
 * Every macro cell a rect touches — the whole cells its area intersects, so a half-anchored
 * footprint counts both of the cells it straddles.
 *
 * That definition is what makes a cell bucket exact for overlap: two rects that overlap at all share
 * a point, and the cell holding that point is touched by both. A cell-share test can therefore
 * replace a chunk scan without changing an answer.
 */
function forEachCell(rect: Rect, fn: (key: string) => void): void {
  const x0 = Math.floor(rect.x), x1 = Math.ceil(rect.x + rect.w) - 1;
  const y0 = Math.floor(rect.y), y1 = Math.ceil(rect.y + rect.h) - 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) fn(cellKey(x, y));
  }
}

function makeEntry(obj: PlacedObject, ord: number): ObjectIndexEntry {
  const item = getCatalogItem(obj.catalogId);
  return { obj, rect: objectRect(obj, item), item, coating: !!item && isCoating(item), ord };
}

/** First position in the ord-ascending `entries` whose ord is >= `ord`. Both the
 *  insert and the drop locate their slot this way — a linear scan here would put
 *  the per-object cost back in step with the map's total object count. */
function lowerBound(entries: ObjectIndexEntry[], ord: number): number {
  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((entries[mid] as ObjectIndexEntry).ord < ord) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Inserts `entry` keeping `list` ord-ascending: a re-add (a rotate, a corner edit) reuses its old
 *  ord, so it can land mid-list. */
function insertByOrd(list: ObjectIndexEntry[], entry: ObjectIndexEntry): void {
  const last = list[list.length - 1];
  if (!last || last.ord < entry.ord) list.push(entry);
  else list.splice(lowerBound(list, entry.ord), 0, entry);
}

/** Insert `entry` into every derived structure. */
function insertEntry(index: ObjectIndex, entry: ObjectIndexEntry): void {
  insertByOrd(index.entries, entry);
  index.byId.set(entry.obj.id, entry);
  const id = entry.obj.catalogId;
  index.countByCatalog.set(id, (index.countByCatalog.get(id) ?? 0) + 1);
  if (entry.coating && !isSurfacePrint(entry.item) && !entry.obj.patchOnly) {
    index.roadByCell.set(cellKey(entry.obj.position.x, entry.obj.position.y), entry.obj);
  }
  forEachChunk(entry.rect, k => {
    const bucket = index.byChunk.get(k);
    // Ord-ascending like `entries`, so a query can merge its buckets instead of sorting them.
    if (!bucket) index.byChunk.set(k, [entry]);
    else insertByOrd(bucket, entry);
  });
  forEachCell(entry.rect, k => {
    const bucket = index.byCell.get(k);
    if (!bucket) { index.byCell.set(k, [entry]); return; }
    const last = bucket[bucket.length - 1];
    if (!last || last.ord < entry.ord) bucket.push(entry);
    else bucket.splice(lowerBound(bucket, entry.ord), 0, entry);
  });
}

/** Drop the entry for `id` from every derived structure. Returns its ord, or
 *  undefined when nothing was indexed under that id (a delta we cannot trust). */
function dropEntry(index: ObjectIndex, id: string): number | undefined {
  const entry = index.byId.get(id);
  if (!entry) return undefined;
  index.byId.delete(id);
  const at = lowerBound(index.entries, entry.ord);
  if (index.entries[at] === entry) index.entries.splice(at, 1);
  const catalogId = entry.obj.catalogId;
  const count = index.countByCatalog.get(catalogId) ?? 0;
  if (count > 1) index.countByCatalog.set(catalogId, count - 1); else index.countByCatalog.delete(catalogId);
  const roadKey = cellKey(entry.obj.position.x, entry.obj.position.y);
  if (index.roadByCell.get(roadKey) === entry.obj) index.roadByCell.delete(roadKey);
  const unbucket = (map: Map<string, ObjectIndexEntry[]>, k: string): void => {
    const bucket = map.get(k);
    if (!bucket) return;
    const i = bucket.indexOf(entry);
    if (i >= 0) bucket.splice(i, 1);
    if (bucket.length === 0) map.delete(k);
  };
  forEachChunk(entry.rect, k => unbucket(index.byChunk, k));
  forEachCell(entry.rect, k => unbucket(index.byCell, k));
  return entry.ord;
}

function buildIndex(state: GridState): ObjectIndex {
  const index: ObjectIndex = {
    entries: [], roadByCell: new Map(), countByCatalog: new Map(),
    byChunk: new Map(), byCell: new Map(), byId: new Map(),
  };
  let ord = 0;
  for (const [, obj] of state.objects) insertEntry(index, makeEntry(obj, ord++));
  return index;
}

/**
 * Fold `state.objectsDelta` into an otherwise-current cache. Returns false when
 * the delta cannot be trusted to describe the whole change, leaving the caller
 * to rebuild.
 *
 * Re-adding an id that is still indexed reuses its ord, matching `Map.set` on an
 * existing key (which keeps the object's insertion position) — so a rotate or
 * corner edit does not silently reorder what consumers iterate.
 */
function patchCached(state: GridState, cached: Cached, version: number): boolean {
  const delta = state.objectsDelta;
  if (!delta || delta.version !== version || cached.version !== version - 1) return false;
  const { index } = cached;
  for (const obj of delta.removed ?? []) {
    if (dropEntry(index, obj.id) === undefined) return false;
  }
  for (const obj of delta.added ?? []) {
    const reused = dropEntry(index, obj.id);
    insertEntry(index, makeEntry(obj, reused ?? cached.nextOrd++));
  }
  if (index.entries.length !== state.objects.size) return false;
  cached.version = version;
  cached.size = state.objects.size;
  return true;
}

export function getObjectIndex(state: GridState): ObjectIndex {
  const version = state.objectsVersion;
  const hit = cache.get(state);
  if (hit) {
    if (hit.version === version && hit.size === state.objects.size) return hit.index;
    if (patchCached(state, hit, version)) return hit.index;
  }
  const index = buildIndex(state);
  cache.set(state, { version, size: state.objects.size, index, nextOrd: index.entries.length });
  return index;
}

/**
 * The `RoadLookup` over `state` that `core`'s edge-cut geometry is handed. Bind it
 * once per operation, never per cell.
 *
 * It resolves the index per call: an untrusted delta replaces the whole `ObjectIndex`, so a
 * captured handle would go stale, and binding must stay free for the auto-trim preview, which
 * binds a lookup over a scratch grid per pointer move. The settled-path resolve is a WeakMap hit
 * plus two comparisons.
 */
export function roadLookup(state: GridState): RoadLookup {
  const lookup: RoadLookup = (x, y) => getObjectIndex(state).roadByCell.get(cellKey(x, y)) ?? null;
  lookup.coatingsAt = (x, y) => (getObjectIndex(state).byCell.get(cellKey(x, y)) ?? [])
    .filter(e => e.coating && !e.obj.patchOnly && e.obj.position.x === x && e.obj.position.y === y)
    .map(e => e.obj);
  return lookup;
}

/** Whether `e` outranks `picked` at one spot: a solid over any coating, a higher coating layer over a lower one. */
function outranks(e: ObjectIndexEntry, picked: ObjectIndexEntry | undefined): boolean {
  return !picked || (picked.coating && (!e.coating || coatingLayer(e.item) > coatingLayer(picked.item)));
}

/**
 * The object whose footprint covers `coord`, or null. Tests cell overlap (the macro cell at
 * `coord` intersects the footprint rect), not whether the rect's origin lies inside the cell: a
 * half-anchored footprint (a halfStep ramp/bridge) has no integer origin, so an origin test reads
 * "nothing here" on the cell its own left half is drawn over, while the 3D view's mesh raycast
 * (which hit-tests the mesh itself, not a stored rect) reads that same click as a hit — one click
 * must not get two answers across the views. The two tests agree exactly for a whole-integer
 * footprint. Solids take priority over prints and pavement. Insertion order breaks ties within a layer.
 *
 * Reports what is there, locked or not: whether a found object may change is V-LOCK-02's
 * question. An object whose catalogId is unknown has no footprint to test, so it is skipped.
 */
export function objectAt(index: ObjectIndex, coord: MacroCoord): PlacedObject | null {
  let picked: ObjectIndexEntry | undefined;
  for (const e of entriesCovering(index, { x: coord.x, y: coord.y, w: 1, h: 1 })) {
    if (!e.item || !cellOverlapsRect(e.rect, coord.x, coord.y, PLACEMENT_GRID)) continue;
    if (outranks(e, picked)) picked = e;
  }
  return picked?.obj ?? null;
}

/**
 * The object whose footprint holds map point `point`, or null: the point test the pointer needs,
 * where `objectAt`'s cell test also answers for a half-anchored footprint over the half of the cell
 * it does not cover. Footprints are half-open, [x, x + w) on each axis, and the priority is
 * `objectAt`'s.
 */
export function objectAtPoint(index: ObjectIndex, point: MapPoint): PlacedObject | null {
  let picked: ObjectIndexEntry | undefined;
  for (const e of entriesCovering(index, { x: Math.floor(point.x), y: Math.floor(point.y), w: 1, h: 1 })) {
    const r = e.rect;
    if (!e.item || point.x < r.x || point.x >= r.x + r.w || point.y < r.y || point.y >= r.y + r.h) continue;
    if (outranks(e, picked)) picked = e;
  }
  return picked?.obj ?? null;
}

/** The pavement a walker can step on at (x, y): the cell's road, unless a solid stands over it. */
export function exposedRoadAt(index: ObjectIndex, x: number, y: number): PlacedObject | null {
  const road = index.roadByCell.get(cellKey(x, y));
  if (!road) return null;
  const top = objectAt(index, { x, y });
  return !top || isCoatingItem(getCatalogItem(top.catalogId)) ? road : null;
}

/**
 * Entries whose own footprint touches `rect`, deduped, in insertion order — the question a
 * placement asks, as against `entriesNear`'s "what is in this neighbourhood".
 *
 * A caller looking for anything within a radius means the loose one; a caller testing a footprint
 * against the footprints already standing means this one, which reads cell buckets rather than a
 * whole chunk's population per question.
 *
 * Sorted rather than merged: a footprint touches a handful of cells and each cell holds a couple of
 * entries, so the list is short by construction.
 */
export function entriesCovering(index: ObjectIndex, rect: Rect): ObjectIndexEntry[] {
  const out: ObjectIndexEntry[] = [];
  const seen = new Set<number>();
  forEachCell(rect, k => {
    const bucket = index.byCell.get(k);
    if (!bucket) return;
    for (const e of bucket) {
      if (seen.has(e.ord)) continue;
      seen.add(e.ord);
      out.push(e);
    }
  });
  if (out.length > 1) out.sort((a, b) => a.ord - b.ord);
  return out;
}

/** Surface-coating objects (roads/paths) whose footprint overlaps `rect`. The
 *  overlap rule exempts coatings so an object can be placed over a road; the
 *  intended editor behavior is to strip the covered road and place. Interactive
 *  placement (manual placer, agent place_object) uses this to remove the roads it
 *  covers (and to tell the user/agent it happened). Returns [] when clear. */
export function coatingsUnder(state: GridState, rect: Rect): PlacedObject[] {
  const hit: PlacedObject[] = [];
  for (const e of entriesCovering(getObjectIndex(state), rect)) {
    if (e.coating && rectsOverlap(rect, e.rect)) hit.push(e.obj);
  }
  return hit;
}

/**
 * Entries whose padded chunk range overlaps `rect`, deduped, in insertion order.
 *
 * The buckets are already in order, so this merges them rather than sorting what it collected. The
 * distinction is the whole cost of the query on a dense map: a chunk of a fully paved region holds
 * BUCKET_SIZE² entries, a 1x1 rect touches up to four chunks through the half-cell padding, and
 * sorting a thousand candidates per cell makes a picture paved in roads quadratic in its own density.
 * A merge over at most four already-sorted runs is linear in what it returns.
 *
 * An entry spanning two of the buckets appears in both, so equal ords are consumed together.
 */
export function entriesNear(index: ObjectIndex, rect: Rect): ObjectIndexEntry[] {
  const buckets: ObjectIndexEntry[][] = [];
  forEachChunk(rect, k => {
    const bucket = index.byChunk.get(k);
    if (bucket && bucket.length > 0) buckets.push(bucket);
  });
  if (buckets.length === 0) return [];
  if (buckets.length === 1) return buckets[0]!.slice();
  const at = new Array<number>(buckets.length).fill(0);
  const out: ObjectIndexEntry[] = [];
  for (;;) {
    let pick: ObjectIndexEntry | null = null;
    for (let b = 0; b < buckets.length; b++) {
      const entry = buckets[b]![at[b]!];
      if (entry && (!pick || entry.ord < pick.ord)) pick = entry;
    }
    if (!pick) return out;
    for (let b = 0; b < buckets.length; b++) {
      const entry = buckets[b]![at[b]!];
      if (entry && entry.ord === pick.ord) at[b]!++;
    }
    out.push(pick);
  }
}
