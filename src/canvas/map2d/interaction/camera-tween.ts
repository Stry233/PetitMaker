import type { RefObject } from 'react';
import type { MapRenderer } from '../map-renderer';
import { isMotionReduced } from '../motion-state';

type ViewState = { zoom: number; offsetX: number; offsetY: number };

/** rAF tween over `durationMs` with an ease-out (non-linear) curve. `onFrame`
 *  receives eased progress 0→1 (1 exactly on the final frame). Returns a cancel fn.
 *  Shared by the map-zoom and UI-scale animations. */
function tweenEaseOut(durationMs: number, onFrame: (eased: number) => void): () => void {
  let raf = 0;
  let alive = true;
  const start = performance.now();
  const step = (now: number) => {
    if (!alive) return;
    const p = Math.min((now - start) / durationMs, 1);
    onFrame(1 - Math.pow(1 - p, 3));
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => { alive = false; cancelAnimationFrame(raf); };
}

const lerpView = (a: ViewState, b: ViewState, e: number): ViewState => ({
  zoom: a.zoom + (b.zoom - a.zoom) * e,
  offsetX: a.offsetX + (b.offsetX - a.offsetX) * e,
  offsetY: a.offsetY + (b.offsetY - a.offsetY) * e,
});

/**
 * Mutable cell holding the single in-flight camera tween's cancel fn, so a new
 * camera animation can cancel the previous one and the unmount can cancel any
 * pending one.
 */
export type CameraTweenHandle = { cancel: (() => void) | null };

/**
 * Ease the camera toward a destination view. `toTarget` applies the change to
 * the renderer; we read the resulting view back, rewind to the start, then
 * tween zoom+offset together on an ease-out curve (revalidating rendererRef on
 * every frame). Reduced motion snaps. Stores the in-flight cancel fn on
 * `handle` so the next call (and unmount) can cancel it.
 */
export function animateCamera(
  rendererRef: RefObject<MapRenderer | null>,
  handle: CameraTweenHandle,
  toTarget: (r: MapRenderer) => void,
): void {
  const r = rendererRef.current;
  if (!r) return;
  const from = r.viewport.getView();
  toTarget(r);
  const target = r.viewport.getView();
  if (isMotionReduced()) { r.applyViewportTransform(); return; }
  r.viewport.setView(from);
  handle.cancel?.();
  handle.cancel = tweenEaseOut(220, (e) => {
    const rr = rendererRef.current;
    if (!rr) return;
    rr.viewport.setView(lerpView(from, target, e));
    rr.applyViewportTransform();
  });
}
