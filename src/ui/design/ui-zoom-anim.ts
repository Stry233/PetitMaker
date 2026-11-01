/**
 * The application-layer tween for `uiZoom`. The store's `uiZoom` is the persisted target, written once
 * per user action through `setUiZoom` (`state/store.ts`); renders read that settled target
 * (`useSettledUiZoom`), and the per-frame writers (`scale.tsx:onLiveScale`) read the live value this
 * module eases toward it, so slider, keyboard and Ctrl+/- ease identically.
 *
 * One rAF loop follows the target exponentially with the `ui.zoom.follow` time constant, measured in
 * elapsed time so it moves at one speed at any refresh rate. It always chases the current target from
 * the current value, so a retarget never restarts a front-loaded ease. Reduced motion snaps. The loop
 * stays unrounded: rounding the live value each frame would stall it short of the target.
 */
import { motionValue, type MotionValue } from 'framer-motion';
import { useEditorStore } from '../../state/store';
import { useUiPreviewPose } from './preview';
import { isMotionReduced } from '../../platform/channels/motion-state';
import { createSignal } from '../../core/base/signal';
import { followToward, frameDt } from './motion';

/** Below this distance from the target the follow lands on it. */
const SETTLE_EPSILON = 0.005;

/** The live UI zoom, equal to the store's target at rest; written once per frame of the follow. */
export const uiZoomLive: MotionValue<number> = motionValue(useEditorStore.getState().uiZoom);

let target = uiZoomLive.get();
let raf = 0;
let lastFrameAt: number | undefined;
/** The follow in flight, from the value it last retargeted at to its target, or null at rest. */
const follow = createSignal<{ from: number; to: number } | null>(null);

function settle(): void {
  if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
  lastFrameAt = undefined;
  if (follow.get() !== null) follow.emit(null);
}

function tick(now: number): void {
  const dt = frameDt(lastFrameAt, now);
  lastFrameAt = now;
  const next = followToward(uiZoomLive.get(), target, dt, 'ui.zoom.follow');
  if (Math.abs(target - next) < SETTLE_EPSILON) {
    raf = 0;
    uiZoomLive.set(target);
    settle();
    return;
  }
  uiZoomLive.set(next);
  raf = requestAnimationFrame(tick);
}

function retarget(next: number): void {
  target = next;
  if (isMotionReduced() || uiZoomLive.get() === target) {
    uiZoomLive.set(target);
    settle();
    return;
  }
  follow.emit({ from: uiZoomLive.get(), to: target });
  if (raf === 0) raf = requestAnimationFrame(tick);
}

// The store's uiZoom is the only source of a new target, from any caller (slider release, keyboard,
// reset, Ctrl+/-): one subscription drives every consumer in lockstep. The scale an input-mode switch
// or a turn of the screen brings does not glide: it lands with that commit (`landUiZoom`), which the
// chrome's morph carries, so the live value stays where it stood until the commit has been measured.
useEditorStore.subscribe((state, prev) => {
  if (state.inputMode !== prev.inputMode || state.layoutShape !== prev.layoutShape) {
    target = state.uiZoom;
    if (raf !== 0) settle();
    return;
  }
  if (state.uiZoom !== prev.uiZoom) retarget(state.uiZoom);
});

/** Lands the live UI zoom on the store's at once, in the commit that switches the input mode or the
 *  arrangement (`input-mode.tsx`); a no-op when it already stands there. */
export function landUiZoom(): void {
  target = useEditorStore.getState().uiZoom;
  if (uiZoomLive.get() !== target) uiZoomLive.jump(target);
  settle();
}

/** The follow in flight, or null at rest. */
export function uiZoomSpan(): { from: number; to: number } | null {
  return follow.get();
}

/** Calls `tell` when the follow starts, retargets or settles. */
export function onUiZoomSpan(tell: () => void): () => void {
  return follow.subscribe(() => tell());
}

/** The UI zoom a render lays out for: the store's target, never a frame of the follow. A pictured
 *  shell holds 1 instead: a figure is laid out for its posed window, not for the reader's UI-scale
 *  setting, so its picture does not move when the live interface is rescaled. */
/** The UI zoom a pictured subtree draws at unless its pose names one, so a reader rescaling the live
 *  interface leaves a picture still. */
export const PICTURED_UI_ZOOM = 1;

export function useSettledUiZoom(): number {
  const zoom = useEditorStore((s) => s.uiZoom);
  const pose = useUiPreviewPose();
  return pose ? (pose.uiZoom ?? PICTURED_UI_ZOOM) : zoom;
}

/** Test-only: hard-reset the singleton to the store's current value with no
 *  in-flight animation (mirrors motion-state's `__resetMotionState`). */
export function __resetUiZoomAnim(): void {
  target = useEditorStore.getState().uiZoom;
  uiZoomLive.jump(target);
  settle();
}
