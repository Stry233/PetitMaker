/**
 * The 3D editor's canvas host, mounted beside PixiCanvas and toggled by
 * `viewMode`. The scene is created lazily on first 3D activation (the three
 * chunk stays out of the main bundle), then kept alive across mode switches:
 * hidden means paused (no rAF, GL resources warm), visible means resumed. A
 * different GridState identity disposes the obsolete scene immediately; the
 * replacement is built on the next activation. A stand-in drawn over the live map
 * (`state/map-stand-in.ts`) is the exception: the live map's scene waits under it
 * and each swap keeps the camera.
 */
import { useEffect, useRef, useState } from 'react';
import { editorAnnotationDraw } from '../shared/annotation/draw-options';
import { useAnnotationRedraw } from '../shared/annotation/use-annotation-redraw';
import { useEditorStore } from '../../state/store';
import type { GridState } from '../../core/model/types';
import type { MapRenderer3D } from './scene/map-renderer';
import type { ActiveView } from '../../tools/pointer/runtime';
import { applyViewSettings, useViewSettings } from '../shared/viewport/view-settings';
import { releaseActiveView, setActiveView } from '../active-view';
import { usePointerInteraction } from '../interaction/use-pointer-interaction';
import { useCursor } from '../interaction/use-cursor';
import { mapHostAttr } from '../interaction/map-wheel';
import { takeParkedCamera } from '../shared/viewport/parked-camera';
import { setMapRenderer3D } from './scene/renderer-registry';
import { shownMap } from '../../state/map-stand-in';
import { loadScene3D } from './scene/preload';
import { showToast } from '../../platform/channels/toast-bus';
import { translate } from '../../i18n/context';

/** `fade` gives the host's CSS transition for becoming visible or hidden, the shell's crossfade with the 2D view. */
export function Editor3DCanvas({ fade }: { fade: (visible: boolean) => string }) {
  const viewMode = useEditorStore((s) => s.viewMode);
  const gridState = useEditorStore(shownMap);
  // The live map, which the map shown stands for: itself, or the live map its stand-in stands over.
  const over = useEditorStore((s) => s.gridState);
  // The Settings 3D-quality choice: the scene bakes it at construction (shadow map, MSAA target,
  // pixel ratio), so a change rebuilds the scene rather than leaving the toggle silently inert.
  const quality3d = useEditorStore((s) => s.quality3d);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<MapRenderer3D | null>(null);
  const builtFor = useRef<GridState | null>(null);
  // The live map `builtFor` stood for when the scene was built.
  const builtOver = useRef<GridState | null>(null);
  const builtQuality = useRef<string | null>(null);
  // The live map's scene, paused and hidden while a stand-in of it is drawn, so that leaving the
  // stand-in shows the live map again at once (`state/map-stand-in.ts`).
  const held = useRef<{ scene: MapRenderer3D; for: GridState; quality: string } | null>(null);
  // The scene registered with the tools and its editing view; the scene builds the view on first request.
  const registered = useRef<{ scene: MapRenderer3D; view: ActiveView } | null>(null);
  const register = (scene: MapRenderer3D): void => {
    registered.current = { scene, view: scene.asEditorView() };
    setActiveView(registered.current.view);
  };
  const unregister = (scene: MapRenderer3D): void => {
    if (registered.current?.scene !== scene) return;
    releaseActiveView(registered.current.view);
    registered.current = null;
  };
  // Detaches the scene from the tools while its overlay still exists, then frees it.
  const disposeScene = (scene: MapRenderer3D): void => {
    const mine = registered.current;
    if (mine?.scene === scene) {
      releaseActiveView(mine.view);
      registered.current = null;
    }
    scene.destroy();
  };
  const install = (scene: MapRenderer3D, map: GridState, mapOver: GridState | null, quality: string): void => {
    sceneRef.current = scene;
    builtFor.current = map;
    builtOver.current = mapOver;
    builtQuality.current = quality;
    setMapRenderer3D(scene, map);
  };
  const uninstall = (): void => {
    sceneRef.current = null;
    builtFor.current = null;
    builtOver.current = null;
    builtQuality.current = null;
    setMapRenderer3D(null, null);
  };
  // The crossfade follows the mode, not the scene's readiness. Holding the 2D map up until the
  // scene has drawn reads as a misclick: the press does nothing, then the view swaps by itself a
  // moment later. An empty view during the build reads as loading, which is what it is; the cost of
  // that build is attacked by loading the scene chunk ahead (`scene/preload.ts`) instead.
  const active = viewMode === '3d';

  // The same pointer machine the 2D canvas runs — tools, selection, camera
  // verbs all route through the active view, which this canvas registers
  // whenever it owns the screen.
  usePointerInteraction(hostRef);
  useCursor(hostRef, active);

  // A context the engine takes and never restores leaves the scene blank; a new generation
  // rebuilds it on a fresh one.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    // Two maps drawn over one place: a live map and its stand-in, or two stand-ins of one map, each
    // known by the live map it stood for.
    const kin = (mapOver: GridState | null): boolean => !!mapOver && !!gridState && mapOver === over;
    if (sceneRef.current && builtFor.current !== gridState && !kin(builtOver.current)) {
      disposeScene(sceneRef.current);
      uninstall();
    }
    if (held.current && (!kin(held.current.for) || held.current.quality !== quality3d)) {
      disposeScene(held.current.scene);
      held.current = null;
    }
    // The held scene's map is shown again: it comes back at once with the view of the scene drawn in its place.
    if (held.current && held.current.for === gridState) {
      const back = held.current;
      held.current = null;
      if (sceneRef.current) {
        back.scene.adoptCamera(sceneRef.current);
        disposeScene(sceneRef.current);
      }
      back.scene.setShown(true);
      install(back.scene, back.for, back.for, back.quality);
      applyViewSettings(back.scene);
    }
    if (!active) {
      sceneRef.current?.pause();
      return;
    }
    if (!host || !gridState) return;
    if (sceneRef.current && builtFor.current === gridState && builtQuality.current === quality3d) {
      sceneRef.current.resume();
      register(sceneRef.current);
      return;
    }
    // A swap to a stand-in or between two: the scene drawn until now gives the next one its view,
    // and a live map's scene waits under the stand-in.
    let from: MapRenderer3D | null = null;
    if (sceneRef.current && builtFor.current && builtFor.current !== gridState) {
      from = sceneRef.current;
      unregister(from);
      from.pause();
      if (!held.current && builtOver.current === builtFor.current) {
        from.setShown(false);
        held.current = { scene: from, for: builtFor.current, quality: builtQuality.current ?? quality3d };
      }
      uninstall();
    }
    const free = (scene: MapRenderer3D): void => { if (scene !== held.current?.scene) disposeScene(scene); };
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
    void loadScene3D().then(({ MapRenderer3D: Scene }) => {
      if (cancelled || !hostRef.current) return;
      if (sceneRef.current) disposeScene(sceneRef.current);
      let scene: MapRenderer3D;
      try {
        // The event bus makes this a live view: edits remesh their dirty chunks, except on a stand-in.
        const { eventBus, gridState: live } = useEditorStore.getState();
        scene = new Scene(hostRef.current, gridState, eventBus, { still: gridState !== live });
      } catch (e) {
        sceneRef.current = null;
        fail(e);
        return;
      }
      scene.onPerformanceLimit = () => { showToast(translate('view3d.performance')); useEditorStore.getState().setViewMode('2d'); };
      scene.onUnrecoverableLoss = () => { builtFor.current = null; setGeneration((g) => g + 1); };
      applyViewSettings(scene);
      install(scene, gridState, over, quality3d);
      if (from) {
        scene.adoptCamera(from);
        free(from);
        from = null;
      } else {
        // A camera parked for this map before the scene existed is applied instead of the intro
        // fly-in: landing where the user left off beats flying somewhere else first.
        const restored = takeParkedCamera(gridState, 'view3d');
        if (restored) scene.applyCameraAngle(restored);
      }
      // The plan-notes layer as it stands when the scene arrives; the effect below carries edits.
      scene.setAnnotations(gridState.annotations ?? null, editorAnnotationDraw());
      if (useEditorStore.getState().viewMode === '3d') register(scene);
    }, fail);
    return () => {
      cancelled = true;
      if (from) free(from);
    };
  }, [active, gridState, over, quality3d, generation]);

  // A scene built later takes the settings at build; this carries each change to a live one.
  useViewSettings(sceneRef);

  // The plan-notes layer redraws off the same store facts the 2D layer draws from; labels bake into
  // canvas textures, so a late font bakes them again.
  useAnnotationRedraw(
    gridState,
    (gs) => sceneRef.current?.setAnnotations(gs.annotations ?? null, editorAnnotationDraw()),
    () => sceneRef.current?.rebakeAnnotationText(),
  );

  useEffect(() => () => {
    if (sceneRef.current) disposeScene(sceneRef.current);
    if (held.current) disposeScene(held.current.scene);
    held.current = null;
    uninstall();
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="editor3d-canvas"
      {...mapHostAttr}
      style={{
        // The whole of the plane it stands in, which is the window less whatever the interface has
        // taken out of it (`ui/shell/Shell.tsx`'s map plane).
        position: 'absolute',
        inset: 0,
        // Touch belongs to the scene, not the page. The renderer's canvas receives this from
        // OrbitControls' own side effect; declaring it on the host covers the host itself and does
        // not depend on that internal.
        touchAction: 'none',
        // Crossfades with the 2D canvas; visibility flips after the fade so the
        // hidden view neither paints nor takes pointer events, while client
        // rects stay meaningful for anything measuring the host (the scene reads
        // clientWidth/Height at construction, which `visibility: hidden` keeps).
        opacity: active ? 1 : 0,
        visibility: active ? 'visible' : 'hidden',
        transition: fade(active),
      }}
    />
  );
}
