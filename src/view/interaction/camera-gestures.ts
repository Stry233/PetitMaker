import { clientPoint } from '../../platform/device/viewport-space';
/**
 * Pointer gestures → camera verbs. The one mapping from what the hand does to how the camera
 * moves, shared by the editor's pointer machine and the export shot editor.
 *
 * It is written against `GestureCamera` rather than a view, so a surface with no tools and no
 * selection (the shot editor) drives the same gestures as the full editor without borrowing the
 * rest of the pointer machine. What it deliberately does not own is the decision to arm a left
 * pan: in the editor that decision is entangled with selection and the active tool, so the caller
 * makes it and calls `panFrom`. Everything downstream of the decision — delta signs, the drag
 * threshold, verb dispatch, the reported drag state — lives here, so both callers answer a drag the
 * same way.
 *
 * Drag state is reported, never written to the cursor controller from here: a caller that is not
 * the visible surface must not move the app's cursor.
 */
import type { ViewCamera } from '../../tools/pointer/runtime';
import type { DragKind } from './cursor-controller';
import { pinchWheelFactor, WheelClassifier, type PinchDelta } from './gestures';
import { isNavButton } from './press/pointer-buttons';
import { navDragVerb, wheelVerb, type CameraCaps } from './press/camera-verbs';

/** Screen px of travel before a nav press counts as a drag rather than a tap. */
export const DRAG_THRESHOLD = 3;

/** The verbs a gesture drives: a camera-only surface (the export shot editor) offers these and
 *  no button glide or fit, which belong to the chrome. */
export type GestureCamera = Omit<ViewCamera, 'zoomStepAnimated' | 'fitToMap'>;

/** One Ctrl+wheel or trackpad-pinch event as a smooth zoom about the pointer. */
export function pinchZoom(camera: GestureCamera, e: WheelEvent): void {
  const at = clientPoint(e);
  camera.zoomBy(pinchWheelFactor(e.deltaY), at.x, at.y);
}

/** What a camera can do, as the verb functions ask it. */
const capsOf = (cam: GestureCamera): CameraCaps => ({ canOrbit: !!cam.orbit });

export interface CameraGestureHost {
  /** The camera to drive, resolved per event; null while no view is live. */
  camera(): GestureCamera | null;
  /** Fired when the drag state changes, so the caller can drive the cursor. */
  onDragChange?(kind: DragKind): void;
  /**
   * A right/middle drag was armed and its release never arrived — something outside the page took
   * the gesture (a browser or extension that claims right-drag for its own mouse gesture). There
   * is no way to ask whether such a handler exists, so this is the only evidence available, and it
   * only ever fires after the gesture has actually failed.
   */
  onGestureLost?(): void;
}

export interface CameraGestures {
  /** Right or middle press: arm camera navigation. True when it took the press. */
  navDown(e: PointerEvent): boolean;
  /** Apply the armed nav drag. True when the move was consumed. */
  navMove(e: PointerEvent): boolean;
  /** Anchor a pan at this screen point (the pan-drag key held, or a left drag the caller decided pans). */
  panFrom(x: number, y: number): void;
  /** Pan by the travel since the anchor, and re-anchor. The caller decides when a pan applies —
   *  in the editor that depends on the tool and the selection — so this never guesses. */
  panStep(e: PointerEvent): void;
  /** Release. `navigated` says a right/middle drag was armed and `moved` whether it travelled past
   *  the threshold; a tap (armed, never moved) opens the context menu, which is the caller's
   *  business. Both are false for a release that was not navigating. */
  navUp(): { navigated: boolean; moved: boolean };
  /** Wheel over the surface, routed by intent. */
  wheel(e: WheelEvent): void;
  /** A two-finger touch delta: zoom, pan and twist together. */
  touch(delta: PinchDelta): void;
  /** Drop any armed gesture without applying it (pointercancel, a second finger). */
  cancel(): void;
  /** The window lost focus. A nav drag still armed here never got its release: that is the
   *  signature of the gesture being taken, so report it. */
  windowBlurred(): void;
  /** Whether a pan anchored by `panFrom` is live. */
  isPanning(): boolean;
  /** Whether a right/middle nav drag is live. */
  isNavigating(): boolean;
}

export function createCameraGestures(host: CameraGestureHost): CameraGestures {
  const wheelClassifier = new WheelClassifier();
  let navigating = false;   // right/middle drag
  let panning = false;      // caller-armed pan
  let moved = false;
  let downX = 0, downY = 0;
  let lastX = 0, lastY = 0;

  const drag = (kind: DragKind) => host.onDragChange?.(kind);

  /** Pan by a screen delta. The verb's sign contract is "the VIEW slides by (dx, dy)", so a drag
   *  that carries the map with the hand passes the inverse of the pointer's travel. */
  const panBy = (e: PointerEvent) => {
    host.camera()?.pan(lastX - clientPoint(e).x, lastY - clientPoint(e).y);
  };

  return {
    navDown(e) {
      if (!isNavButton(e.button)) return false;
      e.preventDefault();
      // Still armed from the last press: its release never arrived, so that gesture was taken.
      if (navigating) host.onGestureLost?.();
      // Middle is a second right: both navigate, so a mouse without a usable right button (or a
      // hand already on the wheel) loses nothing. A drag rotates where the view can orbit and pans
      // where it cannot (2D).
      navigating = true;
      moved = false;
      downX = clientPoint(e).x; downY = clientPoint(e).y;
      lastX = clientPoint(e).x; lastY = clientPoint(e).y;
      const cam = host.camera();
      drag(cam && navDragVerb(capsOf(cam)) === 'orbit' ? 'orbit' : 'pan');
      return true;
    },

    navMove(e) {
      if (!navigating) return false;
      const cam = host.camera();
      if (!cam) return true;
      if (Math.abs(clientPoint(e).x - downX) > DRAG_THRESHOLD || Math.abs(clientPoint(e).y - downY) > DRAG_THRESHOLD) {
        moved = true;
      }
      if (navDragVerb(capsOf(cam)) === 'orbit') cam.orbit!(clientPoint(e).x - lastX, clientPoint(e).y - lastY);
      else panBy(e);
      lastX = clientPoint(e).x; lastY = clientPoint(e).y;
      return true;
    },

    panFrom(x, y) {
      panning = true;
      lastX = x; lastY = y;
      drag('pan');
    },

    panStep(e) {
      panBy(e);
      lastX = clientPoint(e).x; lastY = clientPoint(e).y;
    },

    navUp() {
      const navigated = navigating;
      const was = navigating || panning;
      navigating = false;
      panning = false;
      if (was) {
        // The camera coasts from the velocity it was carrying, where the view has inertia.
        host.camera()?.endGesture?.();
        drag('none');
      }
      return { navigated, moved: navigated && moved };
    },

    wheel(e) {
      const cam = host.camera();
      if (!cam) return;
      const caps = capsOf(cam);
      const lineToPx = e.deltaMode === 1 ? 16 : 1; // Line deltas (rare here) → approx px
      // Only when the horizontal component clearly dominates, so ordinary vertical scroll is
      // untouched by the tilt-wheel/sideways-swipe path.
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) && e.deltaX !== 0;
      const kind = horizontal
        ? 'horizontal'
        : wheelClassifier.classify(e, performance.now()) === 'scroll-pan' ? 'scroll' : 'notch';
      switch (wheelVerb(kind, caps)) {
        case 'yaw':
          cam.orbit!(e.deltaX * lineToPx, 0);
          return;
        case 'zoom-smooth':
          // A sideways-only scroll carries its magnitude in deltaX; a vertical one in deltaY.
          cam.zoomBy(pinchWheelFactor(horizontal ? e.deltaX : e.deltaY), clientPoint(e).x, clientPoint(e).y);
          return;
        case 'zoom-step':
          cam.zoomStep(e.deltaY > 0 ? -1 : 1, clientPoint(e).x, clientPoint(e).y);
      }
    },

    touch(delta) {
      const cam = host.camera();
      if (!cam) return;
      if (delta.scale !== 1) cam.zoomBy(delta.scale, delta.midX, delta.midY);
      if (delta.panX !== 0 || delta.panY !== 0) cam.pan(delta.panX, delta.panY);
      if (delta.twist !== 0) cam.orbitTwist?.(delta.twist);
    },

    cancel() {
      if (!navigating && !panning) return;
      navigating = false;
      panning = false;
      drag('none');
    },

    windowBlurred() {
      if (!navigating) return;
      host.onGestureLost?.();
      navigating = false;
      panning = false;
      drag('none');
    },

    isPanning() {
      return panning;
    },

    isNavigating() {
      return navigating;
    },
  };
}
