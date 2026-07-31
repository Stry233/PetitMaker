/**
 * The 3D editor's canvas host, mounted BESIDE PixiCanvas and toggled by
 * `viewMode`. The scene is created lazily on first 3D activation (the three
 * chunk stays out of the main bundle), then kept alive across mode switches:
 * hidden means paused (no rAF, GL resources warm), visible means resumed. A
 * different GridState identity (new map / import / generate) rebuilds the
 * scene on the next activation.
 */
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../../state/store';
import { selectedObjectIds } from '../../state/selection';
import type { GridState } from '../../core/model/types';
import type { ThreeScene } from './scene/scene';
import { hiddenSetFrom } from '../map2d/layers/layer-visibility';
import { getActiveView, setActiveView } from '../active-view';
import { usePointerInteraction, paintSelection } from '../interaction/usePointerInteraction';
import { useCursor } from '../interaction/use-cursor';
import { registerWindowBridge3D } from './interaction/window-bridge-register';
import { takePendingCameraAngle } from './scene/pending-camera';

export function Editor3DCanvas() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const gridState = useEditorStore((s) => s.gridState);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ThreeScene | null>(null);
  const builtFor = useRef<GridState | null>(null);
  const active = viewMode === '3d';

  // The same pointer machine the 2D canvas runs — tools, selection, camera
  // verbs all route through the active view, which this canvas registers
  // whenever it owns the screen.
  usePointerInteraction(hostRef);
  useCursor(hostRef, active);

  useEffect(() => {
    const host = hostRef.current;
    if (!active) {
      sceneRef.current?.pause();
      return;
    }
    if (!host || !gridState) return;
    if (sceneRef.current && builtFor.current === gridState) {
      sceneRef.current.resume();
      setActiveView(sceneRef.current.asEditorView());
      return;
    }
    let cancelled = false;
    void import('./scene/scene').then(({ ThreeScene: Scene }) => {
      if (cancelled || !hostRef.current) return;
      sceneRef.current?.dispose();
      // The event bus makes this a LIVE view: edits remesh their dirty chunks.
      sceneRef.current = new Scene(hostRef.current, gridState, useEditorStore.getState().eventBus);
      sceneRef.current.setLayerVisibility(hiddenSetFrom(useEditorStore.getState().layerVisibility));
      const st = useEditorStore.getState();
      sceneRef.current.setPassiveOverlays({ grid: st.showGrid, numbers: st.showLayerNumbers, chunks: st.showChunkBounds });
      sceneRef.current.setEditorInput(true);
      builtFor.current = gridState;
      // A camera restored (io/autosave "resume from last") before this scene existed — or before
      // the user ever opened 3D this session — is waiting here. Apply it now instead of running
      // the ~0.8s intro fly-in: landing where the user left off beats flying somewhere else first.
      const restored = takePendingCameraAngle();
      if (restored) sceneRef.current.applyCameraAngle(restored);
      if (useEditorStore.getState().viewMode === '3d') setActiveView(sceneRef.current.asEditorView());
    });
    return () => { cancelled = true; };
  }, [active, gridState]);

  // The camera bridge (io/autosave's read/restore) is registered once; it always reads sceneRef/
  // builtFor LIVE, so it needs no re-registration as the scene is (re)built above.
  useEffect(() => registerWindowBridge3D(sceneRef, builtFor), []);

  // Layer visibility follows the panel in both views; the scene peels terrain,
  // zero-scales hidden-layer objects, and filters the trimmed-road mesh.
  const layerVisibility = useEditorStore((s) => s.layerVisibility);
  useEffect(() => {
    sceneRef.current?.setLayerVisibility(hiddenSetFrom(layerVisibility));
  }, [layerVisibility]);

  // The passive overlays ride the same settings toggles as 2D.
  const showGrid = useEditorStore((s) => s.showGrid);
  const showChunkBounds = useEditorStore((s) => s.showChunkBounds);
  const showLayerNumbers = useEditorStore((s) => s.showLayerNumbers);
  useEffect(() => {
    sceneRef.current?.setPassiveOverlays({ grid: showGrid, numbers: showLayerNumbers, chunks: showChunkBounds });
  }, [showGrid, showChunkBounds, showLayerNumbers]);

  // Re-paint the selection box on the 3D overlay when object geometry changes: a
  // rotate/move swaps the footprint and fires objects-changed but NOT a store
  // update, so without this the box keeps its pre-rotation bounds (or lingers on a
  // deleted object). The 2D canvas does the same on its own overlay; here it must
  // target the ACTIVE (3D) view. Deferred inside the overlay, so it bounds the
  // instance AFTER the scene remeshes it.
  useEffect(() => {
    const bus = useEditorStore.getState().eventBus;
    const onObjectsChanged = () => {
      const store = useEditorStore.getState();
      const view = getActiveView();
      if (store.viewMode !== '3d' || !view || !store.gridState) return;
      // A terrain-only selection cannot be affected by objects-changed.
      if (selectedObjectIds(store.selection).length === 0) return;
      paintSelection(view.overlay, store.gridState, store.selection, store.showLayerNumbers);
    };
    bus.on('objects-changed', onObjectsChanged);
    return () => bus.off('objects-changed', onObjectsChanged);
  }, []);

  useEffect(() => () => { sceneRef.current?.dispose(); sceneRef.current = null; }, []);

  return (
    <div
      ref={hostRef}
      data-testid="editor3d-canvas"
      style={{
        position: 'fixed',
        inset: 0,
        // Crossfades with the 2D canvas; visibility flips after the fade so the
        // hidden view neither paints nor takes pointer events, while client
        // rects stay meaningful for anything measuring the host.
        opacity: active ? 1 : 0,
        visibility: active ? 'visible' : 'hidden',
        transition: active
          ? 'opacity 0.35s ease, visibility 0s linear 0s'
          : 'opacity 0.35s ease, visibility 0s linear 0.35s',
      }}
    />
  );
}
