import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useEditorStore } from '../../state/store';
import { selectedObjectIds } from '../../state/selection';
import { MapRenderer } from './map-renderer';
import { createDefaultRegistry } from '../../rules/index';
import { DEFAULT_MAP } from '../../config/maps';
import { ToolType } from '../../core/model/types';
import { useMotionEnabled } from '../../ui/useMotionEnabled';

import { ToolManager } from '../../tools/tool-manager';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { registerMapSnapshotter } from '../../agent/snapshot';

import { useWasdPan, useUiZoomShortcut } from '../interaction/use-view-shortcuts';
import { usePointerInteraction, paintSelection } from '../interaction/usePointerInteraction';
import { useCursor } from '../interaction/use-cursor';
import { canHoldSelection } from '../interaction/selection-hover';
import { registerToolManager, setActiveView } from '../active-view';
import { registerWindowBridge } from './interaction/window-bridge-register';

export function PixiCanvas() {
  useMotionEnabled(); // sync prefers-reduced-motion into the renderer's motion-state gate
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const toolManagerRef = useRef<ToolManager | null>(null);

  // Keyboard-driven view behaviors, independent of the pointer-gesture machine below.
  useWasdPan(rendererRef);
  useUiZoomShortcut();

  // The pointer-gesture state machine (right-drag pan, wheel zoom, block select,
  // drag-to-move, region brush, context menu) — owns the canvas pointer/wheel
  // listeners with its own mount-only effect, same as when it lived inline.
  usePointerInteraction(containerRef);
  // Both canvases stay mounted, so the cursor surface follows whichever is VISIBLE.
  const viewMode = useEditorStore((s) => s.viewMode);
  useCursor(containerRef, viewMode !== '3d');

  const gridState = useEditorStore((s) => s.gridState);
  const eventBus = useEditorStore((s) => s.eventBus);
  const initMap = useEditorStore((s) => s.initMap);

  // Returning to 2D re-points the tool layer at this view (the 3D canvas
  // registers itself symmetrically when it becomes active).
  useEffect(() => {
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

  // Mount / unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const renderer = new MapRenderer(eventBus, container, w, h);
    rendererRef.current = renderer;

    registerMapSnapshotter(async () => renderer.captureFullMap(1024));

    // Always open a fresh map. If an autosave exists, App offers to restore it via a
    // bubble from the phone (it holds the saved map in memory, so opening fresh here
    // can't lose it) — the editor is usable immediately, restore is opt-in.
    if (!useEditorStore.getState().gridState) {
      initMap(DEFAULT_MAP, createDefaultRegistry());
    }

    // ToolManager is (re)built by the gridState effect once a map is loaded —
    // building it here too would double-init the renderer + tools on first load.
    // Keyboard shortcuts live in ONE place: ui/hooks/useEditorShortcuts (mounted in App).

    // Expose the imperative window.__petit* bridge for the React chrome (zoom
    // buttons ease the camera; map export + agent preview/animation hooks).
    // The teardown it returns deletes every hook + cancels any in-flight
    // camera tween, run from this effect's cleanup.
    const teardownBridge = registerWindowBridge(rendererRef);

    return () => {
      renderer.destroy();
      registerMapSnapshotter(null);
      teardownBridge();
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
  }, [activeTool, designMode, contentType, activeLayer, brushSize]);

  // Buildable region overlay removed — errors now flash on invalid placement instead.

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
    // Re-sync the selection label: hide it when global numbers are on (overlap).
    paintSelection(renderer.overlayLayer, gs, useEditorStore.getState().selection, showLayerNumbers);
  }, [showLayerNumbers]);

  // Re-draw when gridState changes (new project)
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !gridState) return;
    renderer.initMap(gridState, showGrid, showChunkBounds);

    const exec = useEditorStore.getState().commandExecutor;
    if (exec) {
      // ToolManager registers the full default tool set in its constructor.
      toolManagerRef.current = new ToolManager(renderer, exec, gridState);
      registerToolManager(toolManagerRef.current);
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

  // Window resize
  useEffect(() => {
    const onResize = () => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Keep the selection overlay in sync with the store:
  //  - Emptying the selection clears the outline (inverse of showSelection) —
  //    covers delete via context menu, popover, or keyboard uniformly.
  //  - Switching to a tool that cannot select (the paint brushes, the eraser, the
  //    edge cutter) deselects, since a selection is only meaningful while a click
  //    can make one. The object placer keeps its selection ARMED or not: Ctrl-click
  //    selects there, and a click on an existing object selects it for an ad-hoc
  //    rotate/delete while the item stays armed.
  useEffect(() => {
    return useEditorStore.subscribe((state, prev) => {
      if (state.selection.length === 0 && prev.selection.length > 0) {
        rendererRef.current?.overlayLayer.clearSelection();
        return;
      }
      if (state.selection.length > 0) {
        if (!canHoldSelection(state.activeTool)) useEditorStore.getState().clearSelection();
      }
    });
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
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
      }}
    />
  );
}
