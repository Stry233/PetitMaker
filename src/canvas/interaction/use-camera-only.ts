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
import { createCameraGestures } from './camera-gestures';
import { noteNavGestureLost } from './nav-gesture-hint';
import { TouchPinch } from './gestures';
import { isNavButton, PRIMARY_BUTTON } from '../../core/interaction/pointer-buttons';
import type { ViewCamera } from '../view-projection';

export function useCameraOnly(
  hostRef: RefObject<HTMLElement | null>,
  camera: () => ViewCamera | null,
  active: boolean,
): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!active || !host) return;

    const gestures = createCameraGestures({ camera, onDragChange: setCursorDrag, onGestureLost: noteNavGestureLost });
    const touch = new TouchPinch();
    let touchNavigating = false;

    // `move` is the Hand tool's cursor, and a view where every drag moves the camera is Hand mode.
    // The gestures swap in `orbit` while a nav drag is live, exactly as they do in the editor.
    const restoreCursor = pushCursorSurface(host, 'move');

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        const count = touch.down(e.pointerId, e.clientX, e.clientY);
        e.preventDefault();
        if (count >= 2) { gestures.cancel(); touchNavigating = true; }
        else gestures.panFrom(e.clientX, e.clientY);   // one finger drags the ground plane
        return;
      }
      if (gestures.navDown(e)) return;
      if (e.button === PRIMARY_BUTTON) {
        e.preventDefault();
        gestures.panFrom(e.clientX, e.clientY);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        const delta = touch.move(e.pointerId, e.clientX, e.clientY);
        if (delta && touchNavigating) gestures.touch(delta);
        else if (delta && gestures.isPanning()) gestures.touch({ ...delta, scale: 1, twist: 0 });
        return;
      }
      if (gestures.navMove(e)) return;
      if (gestures.isPanning() && (e.buttons & 1) !== 0) gestures.panStep(e);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && touch.up(e.pointerId) > 0) return;
      touchNavigating = false;
      gestures.navUp();
    };

    const onPointerCancel = () => { touch.clear(); touchNavigating = false; gestures.cancel(); };
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
