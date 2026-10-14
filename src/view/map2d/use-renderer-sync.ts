/**
 * What the 2D renderer mirrors beside the shared view settings (`shared/viewport/view-settings.ts`):
 * the plan notes and the canvas box. `PixiCanvas` calls them in the order its effects run.
 */
import { useEffect, type RefObject } from 'react';
import type { GridState } from '../../core/model/types';
import { viewportRect } from '../../platform/device/viewport-space';
import { useEditorStore } from '../../state/store';
import { annotationInkScale } from '../../core/model/annotation/text-metrics';
import { editorAnnotationDraw } from '../shared/annotation/draw-options';
import { useAnnotationRedraw } from '../shared/annotation/use-annotation-redraw';
import type { MapRenderer } from './scene/map-renderer';

/** The plan-notes layer, redrawn whole on any of its inputs; a late font redraws it once more. */
export function useAnnotationSync(rendererRef: RefObject<MapRenderer | null>, gridState: GridState | null): void {
  const draw = (gs: GridState): void => {
    rendererRef.current?.drawAnnotations(gs.annotations ?? null, { ...editorAnnotationDraw(), inkScale: annotationInkScale(gs.template) });
  };
  useAnnotationRedraw(gridState, draw, () => {
    const gs = useEditorStore.getState().gridState;
    if (gs) draw(gs);
  });
}

/*
 * The canvas is sized and placed by its own box, not by the window's.
 *
 * The map is a layer of the interface rather than the page under it: the assistant's docked panel
 * takes a strip of the window and the map occupies what is left, so the box moves without the
 * window changing at all. A `ResizeObserver` is what sees that (the box narrows as the strip
 * opens, every frame of the slide), and the window listener stays for the one thing it alone
 * reports: a page zoom step, which redefines the css px the box is measured in without
 * necessarily changing the number.
 */
export function useBoxSize(containerRef: RefObject<HTMLDivElement | null>, rendererRef: RefObject<MapRenderer | null>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sync = () => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const box = viewportRect(container);
      renderer.resize(box.width, box.height);
    };
    window.addEventListener('resize', sync);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    observer?.observe(container);
    return () => {
      window.removeEventListener('resize', sync);
      observer?.disconnect();
    };
  }, [containerRef, rendererRef]);
}
