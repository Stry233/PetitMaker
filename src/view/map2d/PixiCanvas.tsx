import { viewportRect } from '../../platform/device/viewport-space';
import { useEffect, useRef, useState } from 'react';
import { motion, type Transition } from 'framer-motion';
import { useEditorStore } from '../../state/store';
import { MapRenderer } from './scene/map-renderer';
import { useWasdPan } from '../interaction/use-view-shortcuts';
import { usePointerInteraction } from '../interaction/use-pointer-interaction';
import { useCursor } from '../interaction/use-cursor';
import { mapHostAttr } from '../interaction/map-wheel';
import { releaseActiveView, setActiveView } from '../active-view';
import { setMapRenderer } from './scene/renderer-registry';
import { takeParkedCamera } from '../shared/viewport/parked-camera';
import { poseOfCamera } from './camera/viewport';
import { useAnnotationSync, useBoxSize } from './use-renderer-sync';
import { chunkBoundsShown, shownGridOf, useViewSettings } from '../shared/viewport/view-settings';
import { shownMap } from '../../state/map-stand-in';
import type { GridState } from '../../core/model/types';

/** The 2D view. A WebGL context the engine takes and never restores leaves the canvas blank, so the
 *  view is rebuilt on a fresh one; the map itself lives in the store and is untouched. */
/** `reveal` is the one-time fade the canvas arrives on, passed down from the interface's registry. */
export function PixiCanvas({ reveal }: { reveal: Transition }) {
  const [generation, setGeneration] = useState(0);
  return <Canvas2D key={generation} reveal={reveal} onUnrecoverableLoss={() => setGeneration((g) => g + 1)} />;
}

/**
 * The renderer's mount and the map it draws. The editor's tools (`editor/session/editor-tools.ts`) draw on this
 * view while it is the active one. The store's view settings reach the renderer through
 * `use-renderer-sync.ts`. The effects run in declaration order, and that order is load-bearing: the
 * notes draw before the map is reset.
 */
function Canvas2D({ reveal, onUnrecoverableLoss }: { reveal: Transition; onUnrecoverableLoss: () => void }) {
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

  const gridState = useEditorStore(shownMap);
  // The live map, which the map shown stands for: itself, or the live map its stand-in stands over.
  const over = useEditorStore((s) => s.gridState);
  // The map this view last drew and the live map it stood for then.
  const drew = useRef<{ map: GridState; over: GridState | null } | null>(null);
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

  // Re-draw when the map shown changes (new project, a stand-in); the view is offered to the tools once it draws a map.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !gridState) return;
    // The overlays start as the settings stand; `useViewSettings` applies later changes.
    const s = useEditorStore.getState();
    // Asked of the renderer first: StrictMode's remount brings one that drew nothing.
    const drawn = renderer.asEditorView().rendersState();
    const drawnOver = drawn && drew.current?.map === drawn ? drew.current.over : drawn;
    const kept = drawn && drawnOver === over ? renderer.viewport.getView() : null;
    renderer.initMap(gridState, shownGridOf(s), chunkBoundsShown(s), { still: gridState !== s.gridState });
    drew.current = { map: gridState, over };
    // The camera of the map this one stands in for or for which it stood, else one parked for this
    // map (a restore, a planet session's end), replaces the fit.
    const parked = takeParkedCamera(gridState, 'view2d');
    const pose = kept ?? (parked ? poseOfCamera(parked) : null);
    if (pose) {
      renderer.viewport.setView(pose);
      renderer.applyViewportTransform();
    }
    if (useEditorStore.getState().viewMode === '2d') setActiveView(renderer.asEditorView());
  }, [gridState, over]);

  useBoxSize(containerRef, rendererRef);

  return (
    // A one-time reveal on first mount, gated by MotionConfig. Opacity only: this box's rect is
    // where the projection says the world is, and a transform would misplace the pointer (a scale
    // still running when the renderer was sized left the canvas 2% short of its box).
    <motion.div
      ref={containerRef}
      {...mapHostAttr}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reveal}
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
