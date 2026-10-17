import { viewportRect } from '../../platform/device/viewport-space';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useEditorStore } from '../../state/store';
import { MapRenderer } from './scene/map-renderer';
import { useWasdPan } from '../interaction/use-view-shortcuts';
import { usePointerInteraction } from '../interaction/use-pointer-interaction';
import { useCursor } from '../interaction/use-cursor';
import { releaseActiveView, setActiveView } from '../active-view';
import { setMapRenderer } from './scene/renderer-registry';
import { takeParkedCamera } from '../shared/viewport/parked-camera';
import { animConfig } from '../shared/motion/anim-config';
import { useAnnotationSync, useBoxSize } from './use-renderer-sync';
import { shownGridOf, useViewSettings } from '../shared/viewport/view-settings';

/** The 2D view. A WebGL context the engine takes and never restores leaves the canvas blank, so the
 *  view is rebuilt on a fresh one; the map itself lives in the store and is untouched. */
export function PixiCanvas() {
  const [generation, setGeneration] = useState(0);
  return <Canvas2D key={generation} onUnrecoverableLoss={() => setGeneration((g) => g + 1)} />;
}

/**
 * The renderer's mount and the map it draws. The editor's tools (`editor/session/editor-tools.ts`) draw on this
 * view while it is the active one. The store's view settings reach the renderer through
 * `use-renderer-sync.ts`. The effects run in declaration order, and that order is load-bearing: the
 * notes draw before the map is reset.
 */
function Canvas2D({ onUnrecoverableLoss }: { onUnrecoverableLoss: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);

  // The held-key pan, independent of the pointer-gesture machine below; the one-shot shortcuts
  // are ui/shell/use-editor-shortcuts.ts.
  useWasdPan(rendererRef);

  // The pointer-gesture state machine (right-drag pan, wheel zoom, block select,
  // drag-to-move, region brush, context menu) — it owns the canvas pointer/wheel
  // listeners through its own mount-only effect.
  usePointerInteraction(containerRef);
  // Both canvases stay mounted, so the cursor surface follows whichever is visible.
  const viewMode = useEditorStore((s) => s.viewMode);
  useCursor(containerRef, viewMode !== '3d');

  const gridState = useEditorStore((s) => s.gridState);
  const onLoss = useRef(onUnrecoverableLoss);
  onLoss.current = onUnrecoverableLoss;

  // Returning to 2D re-points the tool layer at this view (the 3D canvas
  // registers itself symmetrically when it becomes active). The renderer also learns whether it
  // is the view on screen: covered by the 3D canvas its loop draws nothing, which on a dense map
  // is the difference between a free 3D session and a second full scene rendered underneath it.
  useEffect(() => {
    rendererRef.current?.setPresenting(viewMode !== '3d');
    if (viewMode === '2d' && rendererRef.current) setActiveView(rendererRef.current.asEditorView());
  }, [viewMode]);

  // Mount / unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const box = viewportRect(container);
    // One renderer per mount, on the bus the editor holds as it mounts.
    const renderer = new MapRenderer(useEditorStore.getState().eventBus, container, box.width, box.height);
    rendererRef.current = renderer;
    // A session can restore straight into 3D (`viewMode` persists), and this mount-only effect
    // runs after the mode effect already looked for a renderer that was not there yet.
    renderer.setPresenting(useEditorStore.getState().viewMode !== '3d');
    setMapRenderer(renderer);
    renderer.onUnrecoverableLoss = () => onLoss.current();

    return () => {
      // Detached while the overlay still exists: the active-view listeners clear what they drew.
      releaseActiveView(renderer.asEditorView());
      renderer.destroy();
      setMapRenderer(null);
      rendererRef.current = null;
    };
  }, []);

  useViewSettings(rendererRef);
  useAnnotationSync(rendererRef, gridState);

  // Re-draw when gridState changes (new project); the view is offered to the tools once it draws a map.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !gridState) return;
    // The overlays start as the settings stand; `useViewSettings` applies later changes.
    const s = useEditorStore.getState();
    renderer.initMap(gridState, shownGridOf(s), s.showChunkBounds);
    // A camera parked for this map (a restore, a planet session's end) replaces the fit.
    const parked = takeParkedCamera(gridState, 'view2d');
    if (parked) {
      renderer.viewport.setView({ zoom: parked.zoom, offsetX: parked.x, offsetY: parked.y });
      renderer.applyViewportTransform();
    }
    if (useEditorStore.getState().viewMode === '2d') setActiveView(renderer.asEditorView());
  }, [gridState]);

  useBoxSize(containerRef, rendererRef);

  return (
    // A one-time reveal on first mount, gated by MotionConfig. Opacity only: this box's rect is
    // where the projection says the world is, and a transform would misplace the pointer (a scale
    // still running when the renderer was sized left the canvas 2% short of its box).
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: animConfig.canvasReveal.durationMs / 1000, ease: animConfig.canvasReveal.ease }}
      style={{
        // The whole of the plane it stands in, which is the window less whatever the interface has
        // taken out of it (`ui/shell/Shell.tsx`'s map plane).
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
      }}
    />
  );
}
