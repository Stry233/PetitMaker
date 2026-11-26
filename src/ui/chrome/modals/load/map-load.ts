import { createSignal } from '../../../../core/base/signal';

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
