/**
 * Every whole-map count the editor reads, derived once: per-layer cell/object counts and per-chunk
 * object load. Per-catalogId tallies live in `state/object-index.ts:countByCatalog` instead, so this
 * module keeps no second, differently-scoped count of the same fact.
 *
 * Memoized per GridState and patched from `state.objectsDelta` rather than rebuilt, because a
 * rebuild costs one catalog lookup, one rect and one chunk bucketing per object and a stroke
 * mutates objects once per cell. The terrain half rebuilds on `cellsVersion`, which is one grid
 * walk per frame in which cells moved: consumers coalesce, and a stroke changes cells for only as
 * long as it lasts.
 *
 * Anything the cache cannot trust falls back to a rebuild, so it can be slow but never stale.
 */
import type { EventBus } from '../core/commands/event-bus';
import { roundLoad } from '../core/model/load';
import { chunkKey } from '../core/grid/rect';
import { isBuildableZone } from '../core/game/zones';
import { mapChunkAt } from '../core/grid/map-chunks';
import { TerrainType, type GridState, type MapTemplate, type ObjectsDelta, type PlacedObject } from '../core/model/types';
import { type EditorEvents } from './editing/events';
import { catalogLoadValue, getCatalogItem } from './catalog';
import { getPlacedObjectSize, objectElevation } from './object-geometry';
import { ELEVATION_MAX } from '../core/game/profile';

interface ChunkStat { objects: number; load: number; unknownLoads: number }

/** A live view, not a snapshot: `getMapStats`'s cached instance is mutated in place by the
 *  object-delta patch path (`applyObject`), so a held reference keeps reading current values
 *  rather than the map state at the moment it was returned. Memoize on its field values, never on
 *  its identity. */
export interface MapStats {
  /** cellsByLayer[n] = cells whose terrain reaches at least layer n. Fixed length
   *  ELEVATION_MAX + 1; index 0 is unused (terrain never occupies layer 0). */
  cellsByLayer: number[];
  /** waterByLayer[n] = cells whose surface is water at exactly layer n, index 0 included: a
   *  ground-level river occupies no layer at all in `cellsByLayer`, so it is invisible there.
   *  A water cell at elevation n is counted at n only — the n-1 layers under it are the mass it
   *  sits on, which `cellsByLayer` already carries. Fixed length ELEVATION_MAX + 1. */
  waterByLayer: number[];
  /** objectsByLayer[n] = unlocked objects standing at elevation n (`objectElevation`, recounted
   *  whenever cells change), patchOnly included: the layer panel's question, which does not care
   *  how a road's corners got cut. Fixed length ELEVATION_MAX + 1. */
  objectsByLayer: number[];
  /** cellsAtElevation[n] = cells whose surface stands at exactly elevation n, clamped to
   *  ELEVATION_MAX; a cell with no terrain counts at 0. Fixed length ELEVATION_MAX + 1. */
  cellsAtElevation: number[];
  /** Cells by terrain type, a cell with no terrain counted as `TerrainType.None`. */
  cellsByTerrain: Record<TerrainType, number>;
  /** The highest elevation any terrain reaches, clamped to ELEVATION_MAX; objects excluded. */
  terrainTop: number;
  /** Cells on buildable ground, at least one, the denominator every floor's share of the map reads. */
  buildableCells: number;
  maxElevation: number;
  /** Per-chunk object count + load. Locked objects (landmarks) do occupy chunk capacity;
   *  patchOnly ones are excluded — a cosmetic corner-cut re-index of a road already on the
   *  map, not new load. Meaningful only while CHUNK_LOAD_ENABLED. */
  chunks: Map<string, ChunkStat>;
}

/** What patching folds against: every object currently counted, by id, as the exact snapshot
 *  it was counted under and the layer it was counted at. Never the live object reference:
 *  command-apply.ts mutates a road's object in place for a corner-cut re-index (same id, same
 *  identity, new corners/rotation/patchOnly), so a stored live reference would drift to describe
 *  the new state and folding it back out would cancel the wrong counts. */
interface FoldedObject { obj: PlacedObject; layer: number }
type Folded = Map<string, FoldedObject>;

interface Cached { stats: MapStats; folded: Folded; objectsVersion: number; cellsVersion: number }

const cache = new WeakMap<GridState, Cached>();

/** The load a placed object adds to the map: a patch-only object is a cosmetic corner-cut re-index
 *  of a road already on the map and adds none. */
export function placedLoad(obj: Pick<PlacedObject, 'catalogId' | 'patchOnly'>): number {
  return obj.patchOnly ? 0 : catalogLoadValue(obj.catalogId);
}

/** Every chunk key an object's footprint touches. Exported for rules/chunk-load.ts, which
 *  needs the same footprint-to-chunk-keys computation for a candidate that has not been
 *  placed yet (so cannot be read back out of `chunks` itself). */
export function chunksOf(obj: PlacedObject, template: Pick<MapTemplate, 'chunkGrid'>): string[] {
  const { w, h } = getPlacedObjectSize(obj);
  const x0 = Math.floor(obj.position.x), x1 = Math.ceil(obj.position.x + w) - 1;
  const y0 = Math.floor(obj.position.y), y1 = Math.ceil(obj.position.y + h) - 1;
  if (x0 > x1 || y0 > y1) return [];
  const keys: string[] = [];
  const first = mapChunkAt(template, x0, y0), last = mapChunkAt(template, x1, y1);
  // Floor/ceil includes every partially covered macro cell at a half-step footprint's edges.
  for (let y = first.cy; y <= last.cy; y++) {
    for (let x = first.cx; x <= last.cx; x++) {
      keys.push(chunkKey(x, y));
    }
  }
  return keys;
}

/** Folds one object into (sign 1) or out of (sign -1) every derived structure except
 *  `maxElevation`, which is a function of the two by-layer arrays and is re-derived once per
 *  call to getMapStats (see deriveMaxElevation) rather than tracked incrementally here — an
 *  incremental high-water mark can only ever rise, so removing the tallest object would leave
 *  it stale.
 *
 *  `locked` and `patchOnly` gate two different questions and must not share a guard: `locked`
 *  (a landmark) is excluded from what the user placed — the layer panel's per-layer counts;
 *  `patchOnly` is excluded from chunk load only — a road's cosmetic corner-cut re-index, still
 *  standing on the map and still in its layer row. */
function applyObject(stats: MapStats, { obj, layer }: FoldedObject, sign: 1 | -1, template: MapTemplate): void {
  if (!obj.locked) {
    stats.objectsByLayer[layer] = (stats.objectsByLayer[layer] ?? 0) + sign;
  }
  if (!obj.patchOnly) {
    const load = placedLoad(obj);
    for (const key of chunksOf(obj, template)) {
      const entry = stats.chunks.get(key) ?? { objects: 0, load: 0, unknownLoads: 0 };
      entry.objects += sign;
      entry.load = roundLoad(entry.load + load * sign);
      if (getCatalogItem(obj.catalogId)?.loadUnknown) entry.unknownLoads += sign;
      if (entry.objects <= 0 && entry.load <= 0) stats.chunks.delete(key);
      else stats.chunks.set(key, entry);
    }
  }
}

/** Fold `obj` in as `folded`'s current entry for its id. An id already present is an in-place
 *  edit (command-apply.ts's road corner-cut re-index publishes `{ added: [obj] }` for an
 *  object already in `state.objects`, mirroring state/object-index's re-add-in-place contract)
 *  — idempotent only because the stored snapshot, not the live object, is folded out first. */
function foldIn(folded: Folded, stats: MapStats, obj: PlacedObject, state: GridState): void {
  const prior = folded.get(obj.id);
  if (prior) applyObject(stats, prior, -1, state.template);
  const entry = { obj: { ...obj }, layer: objectElevation(state, obj) };
  applyObject(stats, entry, 1, state.template);
  folded.set(obj.id, entry);
}

/** Re-buckets every folded object at the elevation the current terrain gives it. */
function recountObjectLayers(state: GridState, stats: MapStats, folded: Folded): void {
  stats.objectsByLayer = freshLayerArray();
  for (const entry of folded.values()) {
    entry.layer = objectElevation(state, entry.obj);
    if (!entry.obj.locked) stats.objectsByLayer[entry.layer] = (stats.objectsByLayer[entry.layer] ?? 0) + 1;
  }
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

const freshTerrainTally = (): Record<TerrainType, number> => ({ [TerrainType.None]: 0, [TerrainType.Mountain]: 0, [TerrainType.Water]: 0 });

function walkTerrain(state: GridState, stats: MapStats): void {
  stats.cellsByLayer = freshLayerArray();
  stats.waterByLayer = freshLayerArray();
  stats.cellsAtElevation = freshLayerArray();
  stats.cellsByTerrain = freshTerrainTally();
  let buildable = 0;
  let top = 0;
  for (let y = 0; y < state.template.height; y++) {
    const row = state.cells[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      if (row[x] && isBuildableZone(row[x]!.zone)) buildable++;
      const terrain = row[x]?.terrain;
      const elevation = terrain ? Math.min(Math.max(terrain.elevation, 0), ELEVATION_MAX) : 0;
      stats.cellsAtElevation[elevation]!++;
      stats.cellsByTerrain[terrain?.type ?? TerrainType.None]++;
      if (!terrain || terrain.type === TerrainType.None) continue;
      if (elevation > top) top = elevation;
      if (terrain.type === TerrainType.Water) {
        stats.waterByLayer[terrain.elevation] = (stats.waterByLayer[terrain.elevation] ?? 0) + 1;
      }
      for (let layer = 1; layer <= terrain.elevation; layer++) {
        stats.cellsByLayer[layer] = (stats.cellsByLayer[layer] ?? 0) + 1;
      }
    }
  }
  stats.buildableCells = Math.max(1, buildable);
  stats.terrainTop = top;
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
    cellsAtElevation: freshLayerArray(), cellsByTerrain: freshTerrainTally(), terrainTop: 0,
    objectsByLayer: freshLayerArray(), buildableCells: 1, maxElevation: 0, chunks: new Map(),
  };
  const folded: Folded = new Map();
  walkTerrain(state, stats);
  for (const obj of state.objects.values()) foldIn(folded, stats, obj, state);
  stats.maxElevation = deriveMaxElevation(stats);
  return { stats, folded };
}

export function getMapStats(state: GridState): MapStats {
  const objectsVersion = state.objectsVersion;
  const cellsVersion = state.cellsVersion;
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
        applyObject(stats, folded.get(obj.id)!, -1, state.template);
        folded.delete(obj.id);
      }
      for (const obj of delta!.added ?? []) foldIn(folded, stats, obj, state);
    }
    if (cached.cellsVersion !== cellsVersion) {
      walkTerrain(state, stats);
      recountObjectLayers(state, stats, folded);
    }
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
 * and `objects-changed` fire once per command — a stroke or a generate issues dozens in one
 * frame — so this collapses a burst to a single `cb` call carrying the state as of the frame it
 * fires in.
 *
 * `getState` is read at fire time, since `initMap`/`loadMap` install a new grid; a `null` return
 * (no map loaded) skips that frame. Two subscribers in one frame cost one derivation walk, because
 * `getMapStats` is memoized per `GridState`.
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
