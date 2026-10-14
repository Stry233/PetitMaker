import { chunkKey } from '../../../../core/grid/rect';
import { chunkName, mapChunkAxes } from '../../../../core/grid/map-chunks';
import type { MapTemplate } from '../../../../core/model/types';
import type { MapStats } from '../../../../state/map-stats';
import { CHUNK_LOAD_ENABLED, CHUNK_LOAD_LIMIT } from '../../../../core/game/profile';
import { createSignal } from '../../../../core/base/signal';

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
 * The region the pointer is in, a module signal written by the disc's listener and read by the disc and its
 * window; null until the pointer has been over the map, and changing identity only on a crossing.
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

/** Every region of a map this size in reading order, the empty ones included: the window answers where there is room. */
export function allChunkLoads(stats: MapStats, template: MapTemplate): ChunkLoad[] {
  if (!CHUNK_LOAD_ENABLED && !import.meta.env.DEV) return [];
  const rows: ChunkLoad[] = [];
  const axes = mapChunkAxes(template);
  for (let cy = 0; cy < axes.rows.length; cy++) {
    for (let cx = 0; cx < axes.columns.length; cx++) rows.push(chunkLoad(stats, cx, cy)!);
  }
  return rows;
}
