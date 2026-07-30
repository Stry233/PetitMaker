/**
 * Memoized spatial index over GridState.objects, shared by every consumer that
 * asks "which objects are here?" — the placement rules and the road/coating
 * lookups. Without it each question is a full scan of the objects Map (with a
 * catalog lookup per entry), and generation/agent strokes ask it millions of
 * times on a decorated map.
 *
 * Freshness: keyed on `state.objectsVersion`, bumped at every object mutation
 * site (command-apply and the placer's temporary self-removal). The size check
 * is a backstop for a missed bump on an add/remove path.
 *
 * Incremental: a rebuild costs one catalog lookup + rect + chunk bucketing PER
 * OBJECT, so rebuilding after each of a stroke's placements is quadratic in the
 * map's object count (a 40x40 road fill on a decorated map spent ~1s doing only
 * that). When the mutation left an `objectsDelta` describing exactly what
 * changed and this cache is one version behind it, the changed entries are
 * patched in instead. Anything unexpected — no delta, a skipped version, an
 * entry the delta claims to remove that is not indexed, a post-patch count that
 * disagrees with `state.objects` — falls back to a full rebuild, so the index
 * can be slow but never stale.
 *
 * Determinism: entries carry their insertion order (`ord`); every query sorts
 * candidates by it, so consumers see the same object order a full insertion-
 * order scan produced.
 */
import { CHUNK_SIZE } from '../core/model/constants';
import { chunkKey, cellKey, type Rect } from '../core/model/grid-model';
import type { GridState, MacroCoord, PlacedObject } from '../core/model/types';
import { getCatalogItem } from './catalog';
import { isCoating } from '../core/model/traits';
import { objectRect } from './object-geometry';
import type { CatalogItem } from '../core/model/types';

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
  /** Entry by object id — the handle an incremental patch needs to find what a
   *  delta refers to without scanning. */
  byId: Map<string, ObjectIndexEntry>;
}

interface Cached { version: number; size: number; index: ObjectIndex; nextOrd: number }
const cache = new WeakMap<GridState, Cached>();

/** Every chunk key an object's rect touches, padded by 0.5 so a terrain cell's
 *  −HALF_TILE-shifted overlap query never needs to look past its own chunk range. */
function forEachChunk(rect: Rect, fn: (key: string) => void): void {
  const cx0 = Math.floor((rect.x - 0.5) / CHUNK_SIZE), cx1 = Math.floor((rect.x + rect.w + 0.5) / CHUNK_SIZE);
  const cy0 = Math.floor((rect.y - 0.5) / CHUNK_SIZE), cy1 = Math.floor((rect.y + rect.h + 0.5) / CHUNK_SIZE);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) fn(chunkKey(cx, cy));
  }
}

function makeEntry(obj: PlacedObject, ord: number): ObjectIndexEntry {
  const item = getCatalogItem(obj.catalogId);
  return { obj, rect: objectRect(obj), item, coating: !!item && isCoating(item), ord };
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

/** Insert `entry` into every derived structure. `entries` stays ord-ascending
 *  (an in-place replacement reuses its old ord, so it can land mid-array). */
function insertEntry(index: ObjectIndex, entry: ObjectIndexEntry): void {
  const { entries } = index;
  const last = entries[entries.length - 1];
  if (!last || last.ord < entry.ord) {
    entries.push(entry);
  } else {
    entries.splice(lowerBound(entries, entry.ord), 0, entry);
  }
  index.byId.set(entry.obj.id, entry);
  const id = entry.obj.catalogId;
  index.countByCatalog.set(id, (index.countByCatalog.get(id) ?? 0) + 1);
  if (entry.coating && !entry.obj.patchOnly) {
    index.roadByCell.set(cellKey(entry.obj.position.x, entry.obj.position.y), entry.obj);
  }
  forEachChunk(entry.rect, k => {
    const bucket = index.byChunk.get(k);
    if (bucket) bucket.push(entry); else index.byChunk.set(k, [entry]);
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
  forEachChunk(entry.rect, k => {
    const bucket = index.byChunk.get(k);
    if (!bucket) return;
    const i = bucket.indexOf(entry);
    if (i >= 0) bucket.splice(i, 1);
    if (bucket.length === 0) index.byChunk.delete(k);
  });
  return entry.ord;
}

function buildIndex(state: GridState): ObjectIndex {
  const index: ObjectIndex = {
    entries: [], roadByCell: new Map(), countByCatalog: new Map(), byChunk: new Map(), byId: new Map(),
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
  const version = state.objectsVersion ?? 0;
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
 * The object whose footprint covers `coord`, or null. Insertion order decides when footprints
 * overlap (a coating under a solid object), matching a full scan of `state.objects`.
 *
 * Reports what is THERE, locked or not: whether a found object may change is V-LOCK-02's
 * question. An object whose catalogId is unknown has no footprint to test, so it is skipped.
 */
export function objectAt(index: ObjectIndex, coord: MacroCoord): PlacedObject | null {
  for (const e of entriesNear(index, { x: coord.x, y: coord.y, w: 1, h: 1 })) {
    if (!e.item) continue;
    const { x, y, w, h } = e.rect;
    if (coord.x >= x && coord.x < x + w && coord.y >= y && coord.y < y + h) return e.obj;
  }
  return null;
}

/** Entries whose padded chunk range overlaps `rect`, deduped, in insertion order. */
export function entriesNear(index: ObjectIndex, rect: Rect): ObjectIndexEntry[] {
  const seen = new Set<number>();
  const out: ObjectIndexEntry[] = [];
  forEachChunk(rect, k => {
    const bucket = index.byChunk.get(k);
    if (!bucket) return;
    for (const e of bucket) {
      if (!seen.has(e.ord)) { seen.add(e.ord); out.push(e); }
    }
  });
  out.sort((a, b) => a.ord - b.ord);
  return out;
}
