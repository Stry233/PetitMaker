/**
 * "Should layout animate right now?" — one answer, for every surface that animates its own size.
 *
 * A framer `layout` animation exists to make a change the USER caused read as motion. A viewport
 * change is not that: the browser has already moved everything, and animating toward the new
 * position means the element chases it — visibly lagging, and, while the drag continues, chasing a
 * target that keeps moving. Dragging a window edge quickly leaves those elements trailing well
 * outside the space they belong in.
 *
 * So the same suppression the UI zoom already had is extended to window resizes (page zoom included,
 * since a zoom step arrives as a resize) and both live behind one hook. A component that animates
 * its width reads this instead of asking about zoom alone, and the next resize-sensitive one has a
 * single thing to read.
 */
import { useSyncExternalStore } from 'react';
import { useUiZooming } from './ui-zoom-anim';

/** How long after the last resize event layout stays instant. Long enough to cover the gap between
 *  events while a window edge is being dragged, short enough that a deliberate change right after
 *  a resize still animates. */
const RESIZE_QUIET_MS = 160;

let resizing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function onResize(): void {
  if (!resizing) { resizing = true; emit(); }
  clearTimeout(timer);
  timer = setTimeout(() => { resizing = false; emit(); }, RESIZE_QUIET_MS);
}

if (typeof window !== 'undefined') window.addEventListener('resize', onResize);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** True while the viewport is being resized (or was, a moment ago). */
export function useResizing(): boolean {
  return useSyncExternalStore(subscribe, () => resizing, () => false);
}

/**
 * True when a layout change should land INSTANTLY rather than animate: the UI zoom is easing, or
 * the viewport is being resized. Pass as `layout={!useInstantLayout()}`.
 */
export function useInstantLayout(): boolean {
  return useUiZooming() || useResizing();
}

/** Test-only: forget an in-flight resize window. */
export function __resetLayoutSettle(): void {
  clearTimeout(timer);
  resizing = false;
}
