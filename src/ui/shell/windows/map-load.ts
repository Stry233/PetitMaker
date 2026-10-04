import { chunkKey } from '../../../core/model/grid-model';
import { chunkName, mapChunkAxes } from '../../../core/model/map-chunks';
import type { MapTemplate } from '../../../core/model/types';
import type { MapStats } from '../../../state/map-stats';
import { CHUNK_LOAD_ENABLED, CHUNK_LOAD_LIMIT } from '../../../core/model/game-profile';
import { createSignal } from '../../../core/runtime/signal';

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
  unknownLoads: number;
}

/** What one region may carry. */
export const CHUNK_LOAD_MAX = CHUNK_LOAD_LIMIT;

export { chunkName };

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
const pointerRegion = createSignal<{ cx: number; cy: number } | null>(null);

export function setPointerRegion(cx: number, cy: number): void {
  const at = pointerRegion.get();
  if (at && at.cx === cx && at.cy === cy) return;
  pointerRegion.emit({ cx, cy });
}

export function getPointerRegion(): { cx: number; cy: number } | null {
  return pointerRegion.get();
}

export function subscribePointerRegion(listener: () => void): () => void {
  return pointerRegion.subscribe(listener);
}

/** What one region carries, or null while there is no reading to give. A region with nothing in it
 *  is not in the stats at all, and reads as empty rather than as absent. */
export function chunkLoad(stats: MapStats, cx: number, cy: number): ChunkLoad | null {
  if (!CHUNK_LOAD_ENABLED && !import.meta.env.DEV) return null;
  const stat = stats.chunks.get(chunkKey(cx, cy));
  return { cx, cy, name: chunkName(cx, cy), value: stat?.load ?? 0, objects: stat?.objects ?? 0, unknownLoads: stat?.unknownLoads ?? 0 };
}

/**
 * Every region of a map this size, in reading order, whether or not it carries anything.
 *
 * The empty ones are the point: a table that listed only the regions holding something would be a
 * list of objects with no map in it, and the question the table answers is where there is room.
 */
export function allChunkLoads(stats: MapStats, template: MapTemplate): ChunkLoad[] {
  if (!CHUNK_LOAD_ENABLED && !import.meta.env.DEV) return [];
  const rows: ChunkLoad[] = [];
  const axes = mapChunkAxes(template);
  for (let cy = 0; cy < axes.rows.length; cy++) {
    for (let cx = 0; cx < axes.columns.length; cx++) rows.push(chunkLoad(stats, cx, cy)!);
  }
  return rows;
}
