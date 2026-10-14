import { clientPoint } from '../../platform/device/viewport-space';
/**
 * Binds a camera-only surface: an overlay that shows the map but has no tools and no selection,
 * so every gesture on it moves the camera. The export shot editor is the one such surface today.
 *
 * It is the small sibling of `usePointerInteraction`: the same gestures through the same
 * `camera-gestures` module and the same cursor controller, minus everything that exists to serve
 * tools. That is what keeps the two 3D views answering a drag the same way — the button map and
 * the cursor are not restated here, they are the shared module's.
 */
import { useEffect, type RefObject } from 'react';
import { pushCursorSurface, setCursorDrag } from './cursor-controller';
import { createCameraGestures, type GestureCamera } from './camera-gestures';
import { releaseTextFocus } from './pointer-focus';
import { noteNavGestureLost } from './nav-gesture-hint';
import { TouchGesture } from './pointer/touch-gesture';
import { isNavButton, PRIMARY_BUTTON } from './press/pointer-buttons';

export function useCameraOnly(
  hostRef: RefObject<HTMLElement | null>,
  camera: () => GestureCamera | null,
  active: boolean,
): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!active || !host) return;

    const gestures = createCameraGestures({ camera, onDragChange: setCursorDrag, onGestureLost: noteNavGestureLost });
    // Fingers move the camera through the editor's own touch gesture: a second finger pinches,
    // pans and twists; one finger slides the ground plane.
    const touch = new TouchGesture(gestures);

    // `move` is the Hand tool's cursor, and a view where every drag moves the camera is Hand mode.
    // The gestures swap in `orbit` while a nav drag is live, exactly as they do in the editor.
    const restoreCursor = pushCursorSurface(host, 'move');

    const onPointerDown = (e: PointerEvent) => {
      releaseTextFocus(host);
      if (touch.down(e, () => gestures.cancel())) return;
      if (e.pointerType === 'touch') {
        e.preventDefault();
        gestures.panFrom(clientPoint(e).x, clientPoint(e).y);
        return;
      }
      if (gestures.navDown(e)) return;
      if (e.button === PRIMARY_BUTTON) {
        e.preventDefault();
        gestures.panFrom(clientPoint(e).x, clientPoint(e).y);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (touch.move(e, gestures.isPanning()) || e.pointerType === 'touch') return;
      if (gestures.navMove(e)) return;
      if (gestures.isPanning() && (e.buttons & 1) !== 0) gestures.panStep(e);
    };

    const onPointerUp = (e: PointerEvent) => {
      // Fingers still down keep the navigation; the last one ends it.
      if (touch.up(e) && touch.navigating) return;
      gestures.navUp();
    };

    const onPointerCancel = (e: PointerEvent) => { touch.cancelled(e); gestures.cancel(); };
    const onWindowBlur = () => gestures.windowBlurred();
    const onAuxClick = (e: MouseEvent) => { if (isNavButton(e.button)) e.preventDefault(); };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); gestures.wheel(e); };
    const onContextMenu = (e: MouseEvent) => e.preventDefault(); // right-drag orbits; it is not a menu

    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('contextmenu', onContextMenu);
    host.addEventListener('auxclick', onAuxClick);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('contextmenu', onContextMenu);
      host.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('blur', onWindowBlur);
      setCursorDrag('none');
      restoreCursor();
    };
  }, [hostRef, camera, active]);
}
