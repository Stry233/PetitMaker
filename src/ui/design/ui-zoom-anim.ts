/**
 * The application-layer tween for `uiZoom`. The store's `uiZoom` is the persisted target, written once
 * per user action through `setUiZoom` (`state/store.ts`); every consumer that turns it into layout
 * (`scale.tsx:useChromeScale`, `shell/use-frame-zoom.ts:useFrameZoom`) reads the animated value from
 * here, so slider, keyboard and Ctrl+/- ease identically.
 *
 * One rAF loop follows the target exponentially with the `ui.zoom.follow` time constant, measured in
 * elapsed time so it moves at one speed at any refresh rate. It always chases the current target from
 * the current value, so a retarget never restarts a front-loaded ease. Reduced motion snaps. The loop
 * stays unrounded: rounding the live value each frame would stall it short of the target.
 */
import { useSyncExternalStore } from 'react';
import { useEditorStore } from '../../state/store';
import { useUiPreviewPose } from './preview';
import { isMotionReduced } from '../../platform/channels/motion-state';
import { createSignal } from '../../core/base/signal';
import { seconds } from './motion';

/** Below this distance from the target the follow lands on it. */
const SETTLE_EPSILON = 0.005;
/** The step a first frame (with no previous timestamp) and a long stall are counted as, in ms. */
const NOMINAL_FRAME_MS = 1000 / 60;
const MAX_FRAME_MS = 100;

/** The follow's next value after `dtMs`: the time-constant form of an exponential ease. */
function followToward(cur: number, target: number, dtMs: number): number {
  const tauMs = seconds('ui.zoom.follow') * 1000;
  return cur + (target - cur) * (1 - Math.exp(-dtMs / tauMs));
}

let live = useEditorStore.getState().uiZoom;
let target = live;
let raf = 0;
let lastFrameAt: number | undefined;
/** True only while the tween is in flight; consumers gate layout animations
 *  and px rounding off during it (both jitter when the scale moves each frame). */
let animating = false;
const zoomFrame = createSignal();
const zoomingChanged = createSignal();

function setAnimating(v: boolean): void {
  if (v === animating) return;
  animating = v;
  zoomingChanged.emit();
}

function tick(now: number): void {
  const dt = lastFrameAt === undefined ? NOMINAL_FRAME_MS : Math.min(Math.max(now - lastFrameAt, 0), MAX_FRAME_MS);
  lastFrameAt = now;
  live = followToward(live, target, dt);
  if (Math.abs(target - live) < SETTLE_EPSILON) {
    live = target;
    raf = 0;
    lastFrameAt = undefined;
    setAnimating(false);
    zoomFrame.emit();
    return;
  }
  zoomFrame.emit();
  raf = requestAnimationFrame(tick);
}

function stop(): void {
  if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
  lastFrameAt = undefined;
  setAnimating(false);
}

function retarget(next: number): void {
  target = next;
  if (isMotionReduced()) {
    live = target;
    stop();
    zoomFrame.emit();
    return;
  }
  if (raf === 0) { setAnimating(true); raf = requestAnimationFrame(tick); }
}

// The store's uiZoom is the only source of a new target, from any caller (slider release, keyboard,
// reset, Ctrl+/-): one subscription drives every consumer in lockstep.
useEditorStore.subscribe((state, prev) => {
  if (state.uiZoom !== prev.uiZoom) retarget(state.uiZoom);
});

function getSnapshot(): number {
  return live;
}

function subscribe(cb: () => void): () => void {
  return zoomFrame.subscribe(cb);
}

/** The animated uiZoom — identical live value across every consumer this frame. A pictured
 *  shell holds 1 instead: a figure is laid out for its posed window, not for the reader's
 *  UI-scale setting, so its picture does not move when the live interface is rescaled. */
export function useAnimatedUiZoom(): number {
  const zoom = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useUiPreviewPose() ? 1 : zoom;
}

function subscribeZoom(cb: () => void): () => void {
  return zoomingChanged.subscribe(cb);
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
  stop();
  live = useEditorStore.getState().uiZoom;
  target = live;
}
