/**
 * Pushes the ACTIVE TOOL's cursor into the controller, and registers the view's container as
 * the surface to write to.
 *
 * Both canvases call this. Separate from usePointerInteraction because this one subscribes to the
 * store, and folding it in would rebuild every pointer listener on a tool switch.
 *
 * `active` is required, not inferred from mount: BOTH canvases stay mounted for the life of the
 * app (App.tsx hides the 2D one with opacity/visibility, Editor3DCanvas's host div renders
 * unconditionally), so ownership of the single cursor surface must follow which view is
 * VISIBLE, never which one's effect happened to run last.
 */
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useEditorStore } from '../../state/store';
import { getActiveToolManager } from '../active-view';
import { registerCursorSurface, releaseCursorSurface, setCursorForbidden, setToolCursor } from './cursor-controller';

export function useCursor(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  const activeTool = useEditorStore((s) => s.activeTool);
  const selectedItemId = useEditorStore((s) => s.selectedItemId);
  const selection = useEditorStore((s) => s.selection);
  const selectingRegion = useEditorStore((s) => s.selectingRegion);
  const contentType = useEditorStore((s) => s.contentType);

  useEffect(() => {
    const el = containerRef.current;
    if (active) {
      registerCursorSurface(el);
      // A viewMode toggle switches views mid-hover with no pointer event in between, so a
      // leftover forbidden badge belongs to the OTHER view's projection.
      setCursorForbidden(false);
    } else {
      releaseCursorSurface(el);
    }
    return () => releaseCursorSurface(el);
  }, [containerRef, active]);

  useEffect(() => {
    // Region select owns the pointer while it is on, so it owns the cursor too.
    if (selectingRegion) { setToolCursor('marquee'); return; }
    const push = () => {
      const tool = getActiveToolManager()?.getActiveTool();
      if (!tool) return false;
      setToolCursor(tool.cursor);
      return true;
    };
    if (push()) return;
    // On first mount the canvas registers its ToolManager in a LATER effect than this one,
    // so there is nothing to read yet. Take the next frame.
    const raf = requestAnimationFrame(push);
    return () => cancelAnimationFrame(raf);
    // EVERY store field a tool's `cursor` getter reads must be a dependency, or the cursor
    // outlives the fact it names. `selection` is here as a CHANGE TRIGGER, not a value read
    // here, so narrowing it to the single member would drop re-pushes. `contentType`: all five
    // shape modes are one ToolType, and picking River or Tile changes contentType only.
  }, [activeTool, selectedItemId, selection, selectingRegion, contentType, active]);
}
