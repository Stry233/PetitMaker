/**
 * Every whole-map count the editor reads, derived once: per-layer cell/object counts (the
 * layer panel) and per-chunk object load (the agent's chunk-load rule and the programmatic API).
 * Per-catalogId tallies live in `state/object-index.ts:countByCatalog` instead — the one other
 * consumer that asks that question (`rules/placement-max-count.ts`) reads it from there, so this
 * module does not keep a second, differently-scoped count of the same fact.
 *
 * Memoized per GridState and PATCHED from `state.objectsDelta` rather than rebuilt, because a
 * rebuild costs one catalog lookup, one rect and one chunk bucketing per object and a stroke
 * mutates objects once per cell. The terrain half rebuilds on `cellsVersion`, which is one grid
 * walk per frame in which cells moved: consumers coalesce, and a stroke changes cells for only as
 * long as it lasts.
 *
 * Anything the cache cannot trust falls back to a rebuild, so it can be slow but never stale.
 */
import type { EventBus } from '../core/commands/event-bus';
import { CHUNK_SIZE, ELEVATION_MAX } from '../core/model/constants';
import { chunkKey } from '../core/model/grid-model';
import { TerrainType, type EditorEvents, type GridState, type ObjectsDelta, type PlacedObject } from '../core/model/types';
import { getCatalogItem } from './catalog';
import { footprintCells, getPlacedObjectSize } from './object-geometry';

export interface ChunkStat { objects: number; load: number }

/** A LIVE view, not a snapshot: `getMapStats`'s cached instance is MUTATED IN PLACE by the
 *  object-delta patch path (`applyObject`), so a held reference keeps reading current values
 *  rather than the map state at the moment it was returned. A future consumer that memoizes on
 *  this object's identity (as opposed to its field values) would be wrong. */
export interface MapStats {
  /** cellsByLayer[n] = cells whose terrain reaches at least layer n. Fixed length
   *  ELEVATION_MAX + 1; index 0 is unused (terrain never occupies layer 0). */
  cellsByLayer: number[];
  /** waterByLayer[n] = cells whose SURFACE is water at exactly layer n, index 0 included: a
   *  ground-level river occupies no layer at all in `cellsByLayer`, so it is invisible there.
   *  A water cell at elevation n is counted at n only — the n-1 layers under it are the mass it
   *  sits on, which `cellsByLayer` already carries. Fixed length ELEVATION_MAX + 1. */
  waterByLayer: number[];
  /** objectsByLayer[n] = unlocked objects standing at elevation n, patchOnly included — the
   *  layer panel's question, which does not care how a road's corners got cut. Fixed length
   *  ELEVATION_MAX + 1. */
  objectsByLayer: number[];
  maxElevation: number;
  /** Per-chunk object count + load. Locked objects (the plaza) DO occupy chunk capacity;
   *  patchOnly ones are excluded — a cosmetic corner-cut re-index of a road already on the
   *  map, not new load. Meaningful only while CHUNK_LOAD_ENABLED. */
  chunks: Map<string, ChunkStat>;
}

/** What patching folds against: every object currently counted, by id, as the exact snapshot
 *  it was counted UNDER. Never the live object reference — command-apply.ts mutates a road's
 *  object in place for a corner-cut re-index (same id, same identity, new corners/rotation/
 *  patchOnly), so a stored live reference would silently drift to describe the NEW state and
 *  folding it back out would cancel the wrong counts. Not part of MapStats: it is patching's
 *  own bookkeeping, never read by a consumer. */
type Folded = Map<string, PlacedObject>;

interface Cached { stats: MapStats; folded: Folded; objectsVersion: number; cellsVersion: number }

const cache = new WeakMap<GridState, Cached>();

const loadOf = (obj: PlacedObject): number => getCatalogItem(obj.catalogId)?.loadValue ?? 0;

/** Every chunk key an object's footprint touches. Exported for rules/chunk-load.ts, which
 *  needs the same footprint-to-chunk-keys computation for a candidate that has not been
 *  placed yet (so cannot be read back out of `chunks` itself). */
export function chunksOf(obj: PlacedObject): string[] {
  const { w, h } = getPlacedObjectSize(obj);
  const keys = new Set<string>();
  // footprintCells, not `pos + integer offset`: a half-integer origin (a halfStep ramp/bridge)
  // names every macro cell it partially covers, including the trailing half cell a plain
  // integer-offset walk from a floored origin never reaches.
  for (const { x, y } of footprintCells(obj.position.x, obj.position.y, w, h)) {
    keys.add(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)));
  }
  return [...keys];
}

/** Folds one object into (sign 1) or out of (sign -1) every derived structure except
 *  `maxElevation`, which is a function of the two by-layer arrays and is re-derived once per
 *  call to getMapStats (see deriveMaxElevation) rather than tracked incrementally here — an
 *  incremental high-water mark can only ever rise, so removing the tallest object would leave
 *  it stale.
 *
 *  `locked` and `patchOnly` gate two DIFFERENT questions and must not share a guard: `locked`
 *  (the plaza) is excluded from what the user placed — the layer panel's per-layer counts;
 *  `patchOnly` is excluded from chunk load only — a road's cosmetic corner-cut re-index, still
 *  standing on the map and still in its layer row. */
function applyObject(stats: MapStats, obj: PlacedObject, sign: 1 | -1): void {
  if (!obj.locked) {
    stats.objectsByLayer[obj.elevation] = (stats.objectsByLayer[obj.elevation] ?? 0) + sign;
  }
  if (!obj.patchOnly) {
    const load = loadOf(obj);
    for (const key of chunksOf(obj)) {
      const entry = stats.chunks.get(key) ?? { objects: 0, load: 0 };
      entry.objects += sign;
      entry.load += load * sign;
      if (entry.objects <= 0 && entry.load <= 0) stats.chunks.delete(key);
      else stats.chunks.set(key, entry);
    }
  }
}

/** Fold `obj` in as `folded`'s current entry for its id. An id already present is an IN-PLACE
 *  edit (command-apply.ts's road corner-cut re-index publishes `{ added: [obj] }` for an
 *  object already in `state.objects`, mirroring state/object-index's re-add-in-place contract)
 *  — idempotent only because the stored snapshot, not the live object, is folded out first. */
function foldIn(folded: Folded, stats: MapStats, obj: PlacedObject): void {
  const prior = folded.get(obj.id);
  if (prior) applyObject(stats, prior, -1);
  applyObject(stats, obj, 1);
  folded.set(obj.id, { ...obj });
}

/** True if every `removed` id is actually folded in — the precondition for patching a removal
 *  at all. Checked before any mutation (not learned by attempting it and giving up midway),
 *  so a rejected delta never leaves `stats`/`folded` partially folded. */
function deltaIsFoldable(folded: Folded, delta: ObjectsDelta): boolean {
  for (const obj of delta.removed ?? []) if (!folded.has(obj.id)) return false;
  return true;
}

/** Fresh fixed-length by-layer array: every index 0..ELEVATION_MAX reads as a real 0, so a
 *  consumer indexing above the map's actual high point (e.g. the layer panel probing one
 *  layer past what is occupied) never sees `undefined`. */
const freshLayerArray = (): number[] => new Array<number>(ELEVATION_MAX + 1).fill(0);

function walkTerrain(state: GridState, stats: MapStats): void {
  stats.cellsByLayer = freshLayerArray();
  stats.waterByLayer = freshLayerArray();
  for (let y = 0; y < state.template.height; y++) {
    const row = state.cells[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const terrain = row[x]?.terrain;
      if (!terrain || terrain.type === TerrainType.None) continue;
      if (terrain.type === TerrainType.Water) {
        stats.waterByLayer[terrain.elevation] = (stats.waterByLayer[terrain.elevation] ?? 0) + 1;
      }
      for (let layer = 1; layer <= terrain.elevation; layer++) {
        stats.cellsByLayer[layer] = (stats.cellsByLayer[layer] ?? 0) + 1;
      }
    }
  }
}

/** The highest layer either half of the map actually occupies. Recomputed from the two
 *  arrays (at most ELEVATION_MAX + 1 entries each) rather than tracked as a running maximum,
 *  so it agrees with the arrays after any combination of a terrain rebuild and an object
 *  patch — including one that just removed the tallest thing on the map. */
function deriveMaxElevation(stats: MapStats): number {
  let max = 0;
  for (let l = 0; l < stats.cellsByLayer.length; l++) if ((stats.cellsByLayer[l] ?? 0) > 0) max = Math.max(max, l);
  for (let l = 0; l < stats.objectsByLayer.length; l++) if ((stats.objectsByLayer[l] ?? 0) > 0) max = Math.max(max, l);
  return max;
}

function rebuild(state: GridState): { stats: MapStats; folded: Folded } {
  const stats: MapStats = {
    cellsByLayer: freshLayerArray(), waterByLayer: freshLayerArray(),
    objectsByLayer: freshLayerArray(), maxElevation: 0, chunks: new Map(),
  };
  const folded: Folded = new Map();
  walkTerrain(state, stats);
  for (const obj of state.objects.values()) {
    applyObject(stats, obj, 1);
    folded.set(obj.id, { ...obj });
  }
  stats.maxElevation = deriveMaxElevation(stats);
  return { stats, folded };
}

export function getMapStats(state: GridState): MapStats {
  const objectsVersion = state.objectsVersion ?? 0;
  const cellsVersion = state.cellsVersion ?? 0;
  const cached = cache.get(state);

  if (cached && cached.objectsVersion === objectsVersion && cached.cellsVersion === cellsVersion) {
    return cached.stats;
  }

  // Objects moving zero steps (only cells changed) needs no delta at all — the cached object
  // arrays are still exactly right. Otherwise a missing delta, a skipped version, a delta this
  // cache is not exactly one step behind, or a removal the fold never saw means the object
  // half cannot be trusted to patch from what we hold.
  const delta = state.objectsDelta;
  const objectsUnchanged = cached !== undefined && cached.objectsVersion === objectsVersion;
  const canPatch =
    cached !== undefined &&
    delta !== undefined &&
    delta.version === objectsVersion &&
    cached.objectsVersion === objectsVersion - 1 &&
    deltaIsFoldable(cached.folded, delta);

  let stats: MapStats;
  let folded: Folded;
  if (cached && (objectsUnchanged || canPatch)) {
    stats = cached.stats;
    folded = cached.folded;
    if (canPatch) {
      for (const obj of delta!.removed ?? []) {
        applyObject(stats, folded.get(obj.id)!, -1);
        folded.delete(obj.id);
      }
      for (const obj of delta!.added ?? []) foldIn(folded, stats, obj);
    }
    if (cached.cellsVersion !== cellsVersion) walkTerrain(state, stats);
    stats.maxElevation = deriveMaxElevation(stats);
  } else {
    ({ stats, folded } = rebuild(state));
  }

  cache.set(state, { stats, folded, objectsVersion, cellsVersion });
  return stats;
}

/**
 * One rAF-coalesced subscription to whole-map stats, for a consumer (the layer panel, the shell's
 * load gauge) that must track edits live without rolling its own coalescing loop. `cells-changed`
 * and `objects-changed` fire once per COMMAND — a stroke or a generate issues dozens in one
 * frame — so this collapses a burst to a single `cb` call carrying the state as of the frame it
 * fires in.
 *
 * `getState` is a parameter, not a store import, so this module stays a pure derivation usable
 * outside the one app that owns a particular store (the same shape as `RoadLookup` and
 * `RuleDispatcher`). It is called at FIRE time, not subscribe time: a `GridState` captured up
 * front would go on answering for a map the user has since replaced, since `initMap`/`loadMap`
 * install a new grid. A `null` return means no map is loaded, so that frame is skipped rather
 * than calling back with empty stats.
 *
 * Two subscribers in the same frame cost only one derivation walk despite each running its own
 * rAF: `getMapStats` is memoized per `GridState`, so whichever of the two fires second is a memo
 * hit on what the first just cached. This function adds no registry to force that — the memo
 * already gives it.
 */
export function subscribeMapStats(
  bus: EventBus<EditorEvents>,
  getState: () => GridState | null,
  cb: (stats: MapStats) => void,
): () => void {
  let raf = 0;
  const fire = () => {
    raf = 0;
    const state = getState();
    if (!state) return;
    cb(getMapStats(state));
  };
  const onChange = () => {
    if (raf) return;
    raf = requestAnimationFrame(fire);
  };
  bus.on('cells-changed', onChange);
  bus.on('objects-changed', onChange);
  return () => {
    bus.off('cells-changed', onChange);
    bus.off('objects-changed', onChange);
    if (raf) cancelAnimationFrame(raf);
  };
}
