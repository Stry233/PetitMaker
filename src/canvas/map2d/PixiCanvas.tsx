import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useEditorStore } from '../../state/store';
import { annotationInkScale } from '../../core/model/annotations';
import { tagLabel } from '../../i18n/annotation-tags';
import { selectedObjectIds } from '../../state/selection';
import { MapRenderer } from './map-renderer';
import { createDefaultRegistry } from '../../rules/index';
import { DEFAULT_MAP } from '../../config/maps';
import { ToolType } from '../../core/model/types';

import { ToolManager } from '../../tools/runtime';
import { DrawingTool } from '../../tools/paint';

import { useWasdPan, useUiZoomShortcut } from '../interaction/use-view-shortcuts';
import { usePointerInteraction, paintSelection } from '../interaction/usePointerInteraction';
import { useCursor } from '../interaction/use-cursor';
import { registerToolManager, setActiveView } from '../active-view';
import { setMapRenderer } from './renderer-registry';

export function PixiCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const toolManagerRef = useRef<ToolManager | null>(null);

  // Keyboard-driven view behaviors, independent of the pointer-gesture machine below.
  useWasdPan(rendererRef);
  useUiZoomShortcut();

  // The pointer-gesture state machine (right-drag pan, wheel zoom, block select,
  // drag-to-move, region brush, context menu) — it owns the canvas pointer/wheel
  // listeners through its own mount-only effect.
  usePointerInteraction(containerRef);
  // Both canvases stay mounted, so the cursor surface follows whichever is VISIBLE.
  const viewMode = useEditorStore((s) => s.viewMode);
  useCursor(containerRef, viewMode !== '3d');

  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);
  const initMap = useEditorStore((s) => s.initMap);

  // Returning to 2D re-points the tool layer at this view (the 3D canvas
  // registers itself symmetrically when it becomes active). The renderer also learns whether it
  // is the view ON SCREEN: covered by the 3D canvas its loop draws nothing, which on a dense map
  // is the difference between a free 3D session and a second full scene rendered underneath it.
  useEffect(() => {
    rendererRef.current?.setPresenting(viewMode !== '3d');
    if (viewMode === '2d' && rendererRef.current) setActiveView(rendererRef.current.asEditorView());
  }, [viewMode]);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showChunkBounds = useEditorStore((s) => s.showChunkBounds);
  const activeTool = useEditorStore((s) => s.activeTool);
  const designMode = useEditorStore((s) => s.designMode);
  const contentType = useEditorStore((s) => s.contentType);
  const activeLayer = useEditorStore((s) => s.activeLayer);
  const brushSize = useEditorStore((s) => s.brushSize);
  const layerVisibility = useEditorStore((s) => s.layerVisibility);
  const layerLocked = useEditorStore((s) => s.layerLocked);
  const showLayerNumbers = useEditorStore((s) => s.showLayerNumbers);
  const annotationsEpoch = useEditorStore((s) => s.annotationsEpoch);
  const annotationDraft = useEditorStore((s) => s.annotationDraft);
  const annotationSelection = useEditorStore((s) => s.annotationSelection);

  // Mount / unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const box = container.getBoundingClientRect();
    const renderer = new MapRenderer(eventBus, container, box.width, box.height);
    rendererRef.current = renderer;
    // A session can restore straight into 3D (`viewMode` persists), and this mount-only effect
    // runs after the mode effect already looked for a renderer that was not there yet.
    renderer.setPresenting(useEditorStore.getState().viewMode !== '3d');
    setMapRenderer(renderer);

    // Always open a fresh map. If an autosave exists, the shell offers to restore it from its own
    // card (which holds the saved map in memory, so opening fresh here can't lose it) — the editor
    // is usable immediately, restore is opt-in.
    if (!useEditorStore.getState().gridState) {
      initMap(DEFAULT_MAP, createDefaultRegistry());
    }

    // ToolManager is (re)built by the gridState effect once a map is loaded —
    // building it here too would double-init the renderer + tools on first load.
    // Keyboard shortcuts live in ONE place: ui/shell/use-editor-shortcuts.

    return () => {
      renderer.destroy();
      setMapRenderer(null);
      rendererRef.current = null;
      toolManagerRef.current = null;
    };
    // Run only on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync store → ToolManager + DrawingTool (so UI changes reach the tool system).
  useEffect(() => {
    const tm = toolManagerRef.current;
    if (!tm) return;
    tm.setActiveTool(activeTool);
    tm.elevation = activeLayer;
    tm.brushSize = brushSize;

    // The DrawingTool carries its shape mode + surface. designMode drives the
    // shape — only the drawing modes apply here (eraser/hand/edge-cut route to
    // other tools, so the last shape is left intact); contentType drives
    // terrain-vs-tile. Sync the registered instance whether active or not.
    const dt = tm.getToolById?.(ToolType.TerrainBrush);
    if (dt instanceof DrawingTool) {
      if (designMode === 'brush' || designMode === 'line' || designMode === 'curve' || designMode === 'rect' || designMode === 'circle') {
        dt.mode = designMode;
      }
      dt.contentType = contentType;
    }
    // The mirror is written; whoever asks a tool a question may ask now. The store told its own
    // subscribers several steps ago, before any of the lines above ran.
    eventBus.emit('tool-synced', { tool: activeTool });
  }, [eventBus, activeTool, designMode, contentType, activeLayer, brushSize]);

  // Sync locked layers to GridState
  useEffect(() => {
    const gs = useEditorStore.getState().gridState;
    if (!gs) return;
    gs.lockedLayers = new Set(
      Object.entries(layerLocked).filter(([, v]) => v).map(([k]) => Number(k))
    );
  }, [layerLocked]);

  // Sync layer visibility to the renderers. Redraws only the affected cells —
  // a panel click must not pay for a full-map terrain rebuild.
  useEffect(() => {
    const renderer = rendererRef.current;
    const gs = useEditorStore.getState().gridState;
    if (!renderer || !gs) return;
    renderer.terrainLayer.applyLayerVisibility(gs, layerVisibility);
    renderer.objectLayer.setLayerVisibility(layerVisibility);
    // The number raster bakes visibility (hidden layers drop their digits).
    renderer.terrainLayer.markNumbersDirty();
    if (renderer.terrainLayer.drawNumbers(gs)) renderer.mountNumberContainer();
  }, [layerVisibility]);

  // Layer-number toggle: a separate concern from visibility — it swaps the
  // number raster and the per-object labels, never terrain graphics.
  useEffect(() => {
    const renderer = rendererRef.current;
    const gs = useEditorStore.getState().gridState;
    if (!renderer || !gs) return;
    renderer.terrainLayer.setShowNumbers(showLayerNumbers);
    renderer.objectLayer.setShowNumbers(showLayerNumbers);
    renderer.terrainLayer.markNumbersDirty();
    renderer.terrainLayer.drawNumbers(gs);
    renderer.mountNumberContainer();
  }, [showLayerNumbers]);

  // The plan-notes layer redraws whole on any of its inputs; the epoch is what says the
  // in-place-mutated data moved. A late-arriving font re-bakes the labels once it lands, or a
  // name typed before the face loaded would keep its fallback raster for the session.
  useEffect(() => {
    const renderer = rendererRef.current;
    const gs = useEditorStore.getState().gridState;
    if (!renderer || !gs) return;
    const draw = () => renderer.annotationLayer.draw(gs.annotations ?? null, {
      draft: useEditorStore.getState().annotationDraft,
      selectionIds: useEditorStore.getState().annotationSelection,
      inkScale: annotationInkScale(gs.template),
      tagLabel: (tag) => tagLabel(tag, useEditorStore.getState().locale),
    });
    draw();
    let stale = false;
    document.fonts?.ready.then(() => { if (!stale) draw(); });
    return () => { stale = true; };
  }, [annotationsEpoch, annotationDraft, annotationSelection, gridState]);

  // Re-draw when gridState changes (new project)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !gridState) return;
    renderer.initMap(gridState, showGrid, showChunkBounds);

    const exec = useEditorStore.getState().commandExecutor;
    if (exec) {
      // ToolManager registers the full default tool set in its constructor.
      const tm = new ToolManager(renderer, exec, gridState);
      // A map that arrives mid-session keeps the arming the shell already shows.
      const s = useEditorStore.getState();
      tm.setActiveTool(s.activeTool);
      tm.elevation = s.activeLayer;
      tm.brushSize = s.brushSize;
      toolManagerRef.current = tm;
      registerToolManager(tm);
      if (useEditorStore.getState().viewMode === '2d') setActiveView(renderer.asEditorView());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridState]);

  // Toggle grid/chunk visibility without resetting viewport
  useEffect(() => {
    const renderer = rendererRef.current;
    const gs = useEditorStore.getState().gridState;
    if (!renderer || !gs) return;
    renderer.updateGridVisibility(showGrid, showChunkBounds);
  }, [showGrid, showChunkBounds]);

  /*
   * THE CANVAS IS SIZED AND PLACED BY ITS OWN BOX, not by the window's.
   *
   * The map is a layer of the interface rather than the page under it: the assistant's docked panel
   * takes a strip of the window and the map occupies what is left, so the box moves without the
   * window changing at all. A `ResizeObserver` is what sees that (the box narrows as the strip
   * opens, every frame of the slide), and the window listener stays for the one thing it alone
   * reports: a PAGE ZOOM step, which redefines the css px the box is measured in without
   * necessarily changing the number.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sync = () => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const box = container.getBoundingClientRect();
      renderer.resize(box.width, box.height);
    };
    window.addEventListener('resize', sync);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    observer?.observe(container);
    return () => {
      window.removeEventListener('resize', sync);
      observer?.disconnect();
    };
  }, []);

  // Re-paint the selection box when the selected object's geometry changes — a
  // rotation (or move) swaps its footprint and fires objects-changed, but NOT a
  // store update, so the subscription above won't catch it; without this the
  // outline keeps the pre-rotation width/height.
  useEffect(() => {
    const onObjectsChanged = () => {
      const renderer = rendererRef.current;
      const store = useEditorStore.getState();
      if (!renderer || !store.gridState) return;
      // A terrain-only selection cannot be affected by objects-changed.
      if (selectedObjectIds(store.selection).length > 0) {
        paintSelection(renderer.overlayLayer, store.gridState, store.selection, store.showLayerNumbers);
      }
    };
    eventBus.on('objects-changed', onObjectsChanged);
    return () => eventBus.off('objects-changed', onObjectsChanged);
  }, [eventBus]);

  return (
    // One-shot cold-start reveal on first mount. MotionConfig gates it
    // under reduced motion; map re-loads don't remount this, so it fires once.
    //
    // OPACITY ONLY, AND THAT IS FORCED: this box is the surface a pointer is projected onto, and its
    // rect is what says where the world is (the effect above, and the projection's origin with it).
    // A transform here is a lie about that for as long as it runs, and a scale that had not finished
    // when the renderer was sized left the canvas permanently 2% short of its own box.
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
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
