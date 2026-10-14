import type { MapRenderer } from '../scene/map-renderer';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import { easeOutCubic, animConfig } from '../../shared/motion/anim-config';

type ViewState = { zoom: number; offsetX: number; offsetY: number };

/** rAF tween over `durationMs` with an ease-out (non-linear) curve. `onFrame`
 *  receives eased progress 0→1 (1 exactly on the final frame). Returns a cancel fn. */
function tweenEaseOut(durationMs: number, onFrame: (eased: number) => void): () => void {
  let raf = 0;
  let alive = true;
  const start = performance.now();
  const step = (now: number) => {
    if (!alive) return;
    const p = Math.min((now - start) / durationMs, 1);
    onFrame(easeOutCubic(p));
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
 * Ease `renderer`'s camera toward a destination view. `toTarget` applies the change to the
 * renderer; the resulting view is read back, the camera rewound to the start, and zoom and offset
 * tween together on an ease-out curve. Reduced motion snaps. The in-flight cancel is stored on
 * `handle`, which the renderer owns, so the next glide and the renderer's teardown cancel it.
 */
export function animateCamera(
  renderer: MapRenderer,
  handle: CameraTweenHandle,
  toTarget: (r: MapRenderer) => void,
): void {
  const from = renderer.viewport.getView();
  toTarget(renderer);
  const target = renderer.viewport.getView();
  if (isMotionReduced()) { renderer.applyViewportTransform(); return; }
  renderer.viewport.setView(from);
  handle.cancel?.();
  handle.cancel = tweenEaseOut(animConfig.cameraGlide.map2dMs, (e) => {
    renderer.viewport.setView(lerpView(from, target, e));
    renderer.applyViewportTransform();
  });
}
