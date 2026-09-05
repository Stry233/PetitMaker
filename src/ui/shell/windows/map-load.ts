/*
 * Per-chunk load reading using the same values and limits as placement validation. Chunk names match
 * the renderer's row letters and column numbers. Until load values are confirmed, production hides
 * the indicator and disables the rule; development may display provisional values for evaluation.
 * The reading is derived and never persisted.
 */
import { CHUNK_LOAD_ENABLED, CHUNK_LOAD_LIMIT, CHUNK_SIZE } from '../../../core/model/constants';
import { chunkKey } from '../../../core/model/grid-model';
import type { MapStats } from '../../../state/map-stats';

/** Whether the indicator is drawn at all. */
export const MAP_LOAD_SHOWN = CHUNK_LOAD_ENABLED || import.meta.env.DEV;

/** One region of the map: where it is, what it is called, and what it carries. */
export interface ChunkLoad {
  cx: number;
  cy: number;
  /** "A1", "B4": the name the map itself draws at that row and column. */
  name: string;
  /** Load carried, in the same units the chunk-load rule holds a placement to. */
  value: number;
  /** How many objects stand there, which is what the value is derived from. */
  objects: number;
}

/** What one region may carry. */
export const CHUNK_LOAD_MAX = CHUNK_LOAD_LIMIT;

/**
 * A region's name, from its column and row.
 *
 * The same rule `canvas/map2d/map-renderer.ts` letters and numbers the map's edges by: rows are
 * A, B, C down the left and columns are 1, 2, 3 along the bottom. Rows wrap at Z, as they do there.
 */
export function chunkName(cx: number, cy: number): string {
  return `${String.fromCharCode(65 + (cy % 26))}${cx + 1}`;
}

/**
 * WHICH REGION THE POINTER IS IN, held here and nowhere else.
 *
 * A module singleton rather than store state, the way the cursor controller and the curve session
 * are: it is written by one place (the disc's own pointer listener) and read by two (the disc and
 * the window it opens), it changes far more often than anything that belongs in a store, and it is
 * not part of the map. It is NULL until the pointer has been over the map at all, which is a state
 * the disc has an answer for and the window does not need one for.
 *
 * The snapshot's identity only changes when the region does, so a `useSyncExternalStore` reader
 * re-renders on a crossing and not on a move.
 */
let pointerRegion: { cx: number; cy: number } | null = null;
const regionListeners = new Set<() => void>();

export function setPointerRegion(cx: number, cy: number): void {
  if (pointerRegion && pointerRegion.cx === cx && pointerRegion.cy === cy) return;
  pointerRegion = { cx, cy };
  for (const listener of regionListeners) listener();
}

export function getPointerRegion(): { cx: number; cy: number } | null {
  return pointerRegion;
}

export function subscribePointerRegion(listener: () => void): () => void {
  regionListeners.add(listener);
  return () => { regionListeners.delete(listener); };
}

/** The region a macro cell falls in. */
export function chunkAt(x: number, y: number): { cx: number; cy: number } {
  return { cx: Math.floor(x / CHUNK_SIZE), cy: Math.floor(y / CHUNK_SIZE) };
}

/** How many regions a map that many cells wide is divided into. */
export function chunksAcross(cells: number): number {
  return Math.max(1, Math.ceil(cells / CHUNK_SIZE));
}

/** What one region carries, or null while there is no reading to give. A region with nothing in it
 *  is not in the stats at all, and reads as empty rather than as absent. */
export function chunkLoad(stats: MapStats, cx: number, cy: number): ChunkLoad | null {
  if (!CHUNK_LOAD_ENABLED && !import.meta.env.DEV) return null;
  const stat = stats.chunks.get(chunkKey(cx, cy));
  return { cx, cy, name: chunkName(cx, cy), value: stat?.load ?? 0, objects: stat?.objects ?? 0 };
}

/**
 * Every region of a map this size, in reading order, whether or not it carries anything.
 *
 * The empty ones are the point: a table that listed only the regions holding something would be a
 * list of objects with no map in it, and the question the table answers is where there is room.
 */
export function allChunkLoads(stats: MapStats, width: number, height: number): ChunkLoad[] {
  if (!CHUNK_LOAD_ENABLED && !import.meta.env.DEV) return [];
  const rows: ChunkLoad[] = [];
  for (let cy = 0; cy < Math.ceil(height / CHUNK_SIZE); cy++) {
    for (let cx = 0; cx < Math.ceil(width / CHUNK_SIZE); cx++) rows.push(chunkLoad(stats, cx, cy)!);
  }
  return rows;
}
