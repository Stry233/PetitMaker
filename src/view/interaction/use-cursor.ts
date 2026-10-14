/**
 * Pushes the active tool's cursor into the controller, and registers the view's container as
 * the surface to write to.
 *
 * Both canvases call this.
 *
 * `active` is required, not inferred from mount: Both canvases stay mounted for the life of the
 * app (App.tsx hides the 2D one with opacity/visibility, Editor3DCanvas's host div renders
 * unconditionally), so ownership of the single cursor surface must follow which view is
 * Visible, never which one's effect happened to run last.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useEditorStore } from '../../state/store';
import { getActiveToolManager } from '../active-view';
import { installKeyTracking } from '../../platform/input/held-keys';
import { isCommandHeld, onCommandHeldChange } from '../../state/keymap/held';
import { registerCursorSurface, releaseCursorSurface, setCursorForbidden, setCursorPanReady, setToolCursor } from './cursor-controller';
import { armingOf, sameArming } from '../../state/editing/arming';

export function useCursor(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    installKeyTracking();
    const sync = () => setCursorPanReady(isCommandHeld('camera.pan_drag'));
    sync();
    const unsubscribe = onCommandHeldChange('camera.pan_drag', sync);
    return () => { unsubscribe(); setCursorPanReady(false); };
  }, [active]);

  useEffect(() => {
    const el = containerRef.current;
    if (active) {
      registerCursorSurface(el);
      // A viewMode toggle switches views mid-hover with no pointer event in between, so a
      // leftover forbidden badge belongs to the other view's projection.
      setCursorForbidden(false);
    } else {
      releaseCursorSurface(el);
    }
    return () => releaseCursorSurface(el);
  }, [containerRef, active]);

  useEffect(() => {
    const push = () => {
      // Region select owns the pointer while it is on, so it owns the cursor too.
      if (useEditorStore.getState().selectingRegion) { setToolCursor('marquee'); return; }
      const cursor = getActiveToolManager()?.getActiveCursor();
      if (cursor) setToolCursor(cursor);
    };
    // A tool's `cursor(ctx)` reads the store only through its arming (`state/editing/arming.ts`),
    // so a change of arming is a change of cursor; the selection triggers the select modes' cursors.
    let last = useEditorStore.getState();
    const offStore = useEditorStore.subscribe((s) => {
      const changed = !sameArming(armingOf(s), armingOf(last))
        || s.selection !== last.selection || s.selectingRegion !== last.selectingRegion;
      last = s;
      if (changed) push();
    });
    // The manager mirrors the store, and the session writes that mirror in its own subscription:
    // whether this one runs before or after it is subscription order, which is not a fact about
    // cursors. `tool-synced` is the session saying the mirror is written, so the push that lands is
    // the one made after it.
    const eventBus = useEditorStore.getState().eventBus;
    eventBus.on('tool-synced', push);
    push();
    // On first mount the canvas registers its ToolManager in a later effect than this one, and no
    // sync follows a registration on its own. Take the next frame.
    const raf = requestAnimationFrame(push);
    return () => {
      offStore();
      eventBus.off('tool-synced', push);
      cancelAnimationFrame(raf);
    };
  }, [active]);
}
