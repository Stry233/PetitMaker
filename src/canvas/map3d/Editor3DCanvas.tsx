/**
 * The 3D editor's canvas host, mounted BESIDE PixiCanvas and toggled by
 * `viewMode`. The scene is created lazily on first 3D activation (the three
 * chunk stays out of the main bundle), then kept alive across mode switches:
 * hidden means paused (no rAF, GL resources warm), visible means resumed. A
 * different GridState identity (new map / import / generate) rebuilds the
 * scene on the next activation.
 */
import { useEffect, useRef } from 'react';
import { tagLabel } from '../../i18n/annotation-tags';
import { useEditorStore } from '../../state/store';
import { selectedObjectIds } from '../../state/selection';
import type { GridState } from '../../core/model/types';
import type { ThreeScene } from './scene/scene';
import { hiddenSetFrom } from '../map2d/layers/layer-visibility';
import { getActiveView, setActiveView } from '../active-view';
import { usePointerInteraction, paintSelection } from '../interaction/usePointerInteraction';
import { useCursor } from '../interaction/use-cursor';
import { takePendingCameraAngle } from './scene/pending-camera';
import { setScene3D } from './scene/camera-registry';
import { showToast } from '../../core/runtime/toast-bus';
import { translate } from '../../i18n/context';

export function Editor3DCanvas() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const gridState = useEditorStore((s) => s.gridState);
  // The Settings 3D-quality choice: the scene bakes it at construction (shadow map, MSAA target,
  // pixel ratio), so a change rebuilds the scene rather than leaving the toggle silently inert.
  const quality3d = useEditorStore((s) => s.quality3d);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ThreeScene | null>(null);
  const builtFor = useRef<GridState | null>(null);
  const builtQuality = useRef<string | null>(null);
  // The crossfade follows the MODE, not the scene's readiness. Holding the 2D map up until the
  // scene has drawn reads as a misclick: the press does nothing, then the view swaps by itself a
  // moment later. An empty view during the build reads as loading, which is what it is; the cost of
  // that build is attacked by `preloadScene3D` instead.
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
    if (sceneRef.current && builtFor.current === gridState && builtQuality.current === quality3d) {
      sceneRef.current.resume();
      setActiveView(sceneRef.current.asEditorView());
      return;
    }
    let cancelled = false;
    // A browser that cannot start the scene (no WebGL context, a chunk that fails to fetch or
    // parse) must not strand the user on a blank view: the 2D canvas has already faded out, so
    // without this the click on 3D is a white screen with no way back. Say why, and return to the
    // view that works.
    const fail = (e: unknown): void => {
      if (cancelled) return;
      console.error('[3d] scene build failed', e);
      showToast(translate('view3d.unavailable'), 'error');
      useEditorStore.getState().setViewMode('2d');
    };
    void import('./scene/scene').then(({ ThreeScene: Scene }) => {
      if (cancelled || !hostRef.current) return;
      sceneRef.current?.dispose();
      try {
        // The event bus makes this a LIVE view: edits remesh their dirty chunks.
        sceneRef.current = new Scene(hostRef.current, gridState, useEditorStore.getState().eventBus);
      } catch (e) {
        sceneRef.current = null;
        fail(e);
        return;
      }
      sceneRef.current.setLayerVisibility(hiddenSetFrom(useEditorStore.getState().layerVisibility));
      const st = useEditorStore.getState();
      sceneRef.current.setPassiveOverlays({ grid: st.showGrid, numbers: st.showLayerNumbers, chunks: st.showChunkBounds });
      sceneRef.current.setEditorInput(true);
      builtFor.current = gridState;
      builtQuality.current = quality3d;
      setScene3D(sceneRef.current, builtFor.current);
      // A camera restored (io/autosave "resume from last") before this scene existed — or before
      // the user ever opened 3D this session — is waiting here. Apply it now instead of running
      // the ~0.8s intro fly-in: landing where the user left off beats flying somewhere else first.
      const restored = takePendingCameraAngle();
      if (restored) sceneRef.current.applyCameraAngle(restored);
      // The plan-notes layer as it stands when the scene arrives; the effect below carries edits.
      const boot = useEditorStore.getState();
      sceneRef.current.setAnnotations(boot.gridState?.annotations ?? null, {
        draft: boot.annotationDraft, selection: boot.annotationSelection,
        tagLabel: (tag) => tagLabel(tag, boot.locale),
      });
      if (useEditorStore.getState().viewMode === '3d') setActiveView(sceneRef.current.asEditorView());
    }, fail);
    return () => { cancelled = true; };
  }, [active, gridState, quality3d]);

  // Layer visibility follows the panel in both views; the scene peels terrain,
  // zero-scales hidden-layer objects, and filters the trimmed-road mesh.
  const layerVisibility = useEditorStore((s) => s.layerVisibility);
  useEffect(() => {
    sceneRef.current?.setLayerVisibility(hiddenSetFrom(layerVisibility));
  }, [layerVisibility]);

  // The plan-notes layer redraws off the same store facts the 2D layer draws from.
  const annotationsEpoch = useEditorStore((s) => s.annotationsEpoch);
  const annotationDraft = useEditorStore((s) => s.annotationDraft);
  const annotationSelection = useEditorStore((s) => s.annotationSelection);
  useEffect(() => {
    const gs = useEditorStore.getState().gridState;
    if (!gs) return;
    sceneRef.current?.setAnnotations(gs.annotations ?? null, {
      draft: annotationDraft, selection: annotationSelection,
      tagLabel: (tag) => tagLabel(tag, useEditorStore.getState().locale),
    });
  }, [annotationsEpoch, annotationDraft, annotationSelection, gridState]);

  // Note labels bake into canvas textures, so lettering rasterised before the app's fonts landed
  // must be baked again once they do (the 2D view redraws on the same signal).
  useEffect(() => {
    let live = true;
    document.fonts?.ready?.then(() => { if (live) sceneRef.current?.rebakeAnnotationText(); });
    return () => { live = false; };
  }, [active]);

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

  useEffect(() => () => { sceneRef.current?.dispose(); sceneRef.current = null; setScene3D(null, null); }, []);

  return (
    <div
      ref={hostRef}
      data-testid="editor3d-canvas"
      style={{
        // The whole of the plane it stands in, which is the window less whatever the interface has
        // taken out of it (`ui/shell/Shell.tsx`'s map plane).
        position: 'absolute',
        inset: 0,
        // Crossfades with the 2D canvas; visibility flips after the fade so the
        // hidden view neither paints nor takes pointer events, while client
        // rects stay meaningful for anything measuring the host (the scene reads
        // clientWidth/Height at construction, which `visibility: hidden` keeps).
        opacity: active ? 1 : 0,
        visibility: active ? 'visible' : 'hidden',
        transition: active
          ? 'opacity 0.35s ease, visibility 0s linear 0s'
          : 'opacity 0.35s ease, visibility 0s linear 0.35s',
      }}
    />
  );
}
