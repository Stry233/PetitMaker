/**
 * ui-zoom-anim.ts — the ONE application-layer tween for `uiZoom` (the UI-scale
 * multiplier). The store's `uiZoom` field is the persisted TARGET, written
 * exactly once per user action — a slider release, an arrow-key step, Ctrl+/-,
 * the reset chip, or double-click (see `setUiZoom` in `state/store.ts`, the
 * single persistence path). Every consumer that turns `uiZoom` into layout
 * (`scale.tsx:useChromeScale` and `shell/use-frame-zoom.ts:useFrameZoom`) reads
 * the ANIMATED value from here instead of the raw store field, so a slider
 * release, a keyboard step, and Ctrl+/- all ease identically — one mechanism,
 * not several reimplementations.
 *
 * A single persistent rAF follow loop (exponential smoothing via
 * `renderer/zoom-accum`'s `followStep`, the one curve every zoom path eases
 * on) chases the store's target. It's a module-level singleton (like
 * `motion-state.ts` / `render-scheduler.ts`) so every consumer
 * reads the exact same live value on the exact same frame — no drift between
 * the menu scale and the centre offset derived from it.
 *
 * Reduced motion snaps instantly (no rAF). A retarget mid-flight is
 * interruptible by construction: the loop always chases the CURRENT target
 * from the CURRENT live value — it never restarts from a fixed duration, so
 * rapid retargets (held keys, a fast second drag) never re-enter a front-
 * loaded ease and shake.
 */
import { useSyncExternalStore } from 'react';
import { useEditorStore } from '../../state/store';
import { useUiPreviewPose } from '../primitives/ui-preview';
import { isMotionReduced } from '../../canvas/map2d/motion-state';
import { followStep } from '../../canvas/map2d/zoom-accum';

let live = useEditorStore.getState().uiZoom;
let target = live;
let raf = 0;
/** True only while the tween is in flight; consumers gate layout animations
 *  and px rounding off during it (both jitter when the scale moves each frame). */
let animating = false;
const listeners = new Set<() => void>();
const zoomListeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}
function setAnimating(v: boolean): void {
  if (v === animating) return;
  animating = v;
  zoomListeners.forEach((l) => l());
}

function tick(): void {
  live = followStep(live, target);
  if (Math.abs(target - live) < 0.005) {
    live = target;
    raf = 0;
    setAnimating(false);
    notify();
    return;
  }
  notify();
  raf = requestAnimationFrame(tick);
}

function retarget(next: number): void {
  target = next;
  if (isMotionReduced()) {
    live = target;
    if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
    setAnimating(false);
    notify();
    return;
  }
  if (raf === 0) { setAnimating(true); raf = requestAnimationFrame(tick); }
}

// The store's uiZoom is the only source of a new TARGET, from any caller
// (slider release, keyboard, reset, Ctrl+/-) — one subscription drives every
// consumer's animation in lockstep.
useEditorStore.subscribe((state, prev) => {
  if (state.uiZoom !== prev.uiZoom) retarget(state.uiZoom);
});

function getSnapshot(): number {
  return live;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The animated uiZoom — identical live value across every consumer this frame. A pictured
 *  shell holds 1 instead: a figure is laid out for its posed window, not for the reader's
 *  UI-scale setting, so its picture does not move when the live interface is rescaled. */
export function useAnimatedUiZoom(): number {
  const zoom = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useUiPreviewPose() ? 1 : zoom;
}

function subscribeZoom(cb: () => void): () => void {
  zoomListeners.add(cb);
  return () => zoomListeners.delete(cb);
}
function getZoomingSnapshot(): boolean {
  return animating;
}

/** True only while the UI-zoom tween is in flight. Elements gate their Framer
 *  `layout` animations and px rounding off during it, so nothing trails or
 *  jitters while the scale moves each frame. Flips at most twice per zoom. */
export function useUiZooming(): boolean {
  return useSyncExternalStore(subscribeZoom, getZoomingSnapshot, () => false);
}

/** Test-only: hard-reset the singleton to the store's current value with no
 *  in-flight animation (mirrors motion-state's `__resetMotionState`). */
export function __resetUiZoomAnim(): void {
  if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
  setAnimating(false);
  live = useEditorStore.getState().uiZoom;
  target = live;
}
