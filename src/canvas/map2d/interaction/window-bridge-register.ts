import type { RefObject } from 'react';
import type { MapRenderer } from '../map-renderer';
import type { MacroCoord } from '../../../core/model/types';
import { petitWindow } from '../../../core/runtime/window-bridge';
import { useEditorStore } from '../../../state/store';
import { singleSelection } from '../../../state/selection';
import { getActiveView } from '../../active-view';
import { paintSpinRing } from '../../interaction/usePointerInteraction';
import { animateCamera, type CameraTweenHandle } from './camera-tween';

/**
 * Register the imperative `window.__petit*` bridge hooks PixiCanvas publishes for
 * the React chrome (zoom buttons, map export, agent preview/animation hooks).
 * Returns a teardown that deletes every hook it set and cancels any in-flight
 * camera tween — called from the mount effect's cleanup.
 *
 * The +/−/Fit buttons ease the camera via the shared `animateCamera`
 * helper; the in-flight tween's cancel fn lives on a local handle so both a fresh
 * button press and the unmount can cancel it. (Wheel/pinch zoom stays direct.)
 */
export function registerWindowBridge(rendererRef: RefObject<MapRenderer | null>): () => void {
  const win = petitWindow();
  const tween: CameraTweenHandle = { cancel: null };
  const screenCenter = (): [number, number] => [window.innerWidth / 2, window.innerHeight / 2];

  // Zoom chrome routes through the ACTIVE view: the 3D view dollies where the
  // 2D view zoom-tweens. (The 2D tween lives in its own path so the chrome
  // buttons keep their eased feel there.)
  win.__petitZoomIn = () => {
    const v = getActiveView();
    if (v?.camera.zoomStepAnimated) v.camera.zoomStepAnimated(1);          // 3D: eased camera glide
    else if (v?.camera.orbit) v.camera.zoomBy(1.25, ...screenCenter());
    else animateCamera(rendererRef, tween, (r) => r.viewport.setZoom(r.viewport.getZoom() * 1.25, ...screenCenter()));
  };
  win.__petitZoomOut = () => {
    const v = getActiveView();
    if (v?.camera.zoomStepAnimated) v.camera.zoomStepAnimated(-1);
    else if (v?.camera.orbit) v.camera.zoomBy(0.8, ...screenCenter());
    else animateCamera(rendererRef, tween, (r) => r.viewport.setZoom(r.viewport.getZoom() * 0.8, ...screenCenter()));
  };
  win.__petitFitMap = () => {
    const gs = useEditorStore.getState().gridState;
    if (!gs) return;
    const v = getActiveView();
    if (v?.camera.fitToMap) v.camera.fitToMap();
    else animateCamera(rendererRef, tween, (r) => r.viewport.fitToMap(gs.template.width, gs.template.height));
  };
  win.__petitCaptureFullMap = (maxPx?: number, includeGrid?: boolean): string | null => {
    // Export pipeline: tightly-framed, chrome-free map image (not the loose world-bounds capture).
    // includeGrid bakes the real 2D grid (sub + cell + chunk lines) into the capture.
    return rendererRef.current?.captureMapImage(maxPx ?? 1024, includeGrid ?? false) ?? null;
  };
  win.__petitShowPreview = (cells: MacroCoord[]) => {
    getActiveView()?.overlay.showBuildableRegion(cells, true);
  };
  win.__petitClearPreview = () => {
    getActiveView()?.overlay.clearBuildableRegion();
  };
  win.__petitGetViewport = () => rendererRef.current?.viewport;
  win.__petitAnimateRemove = (id: string) => {
    rendererRef.current?.objectLayer.animateRemove(id);
  };
  win.__petitAnimateRotation = (id: string, fromDeg: number, toDeg: number) => {
    // The ring rides the SAME per-tick progress the icon/instance gets (see usePointerInteraction's
    // paintSpinRing) — only repainted while `id` is still the live single selection, so a rotate
    // fired from a stale/closed-over id never redraws a ring for something the user isn't looking at.
    const onFrame = (eased: number) => {
      const view = getActiveView();
      const s = useEditorStore.getState();
      if (!view || !s.gridState) return;
      const sel = singleSelection(s.selection);
      if (sel?.kind === 'object' && sel.id === id) {
        paintSpinRing(view.overlay, s.gridState, id, eased, s.showLayerNumbers);
      }
    };
    const v = getActiveView();
    if (v?.animateRotation) v.animateRotation(id, fromDeg, toDeg, onFrame);
    else rendererRef.current?.objectLayer.animateRotation(id, fromDeg, toDeg, onFrame);
  };
  win.__petitFlashCommit = (cells: MacroCoord[], opts?: { color?: number; terrainMode?: boolean }) => {
    getActiveView()?.overlay.flashCommit(cells, opts);
  };
  win.__petitResyncObjects = () => rendererRef.current?.resyncObjects();
  win.__petitGetCamera = () => {
    const r = rendererRef.current;
    if (!r) return undefined;
    const v = r.viewport.getView();
    return { x: v.offsetX, y: v.offsetY, zoom: v.zoom };
  };
  win.__petitSetCamera = (c) => {
    const r = rendererRef.current;
    if (!r) return;
    r.viewport.setView({ zoom: c.zoom, offsetX: c.x, offsetY: c.y });
    r.applyViewportTransform(); // repositions the world container + requests a render
  };

  return () => {
    tween.cancel?.();
    delete win.__petitZoomIn;
    delete win.__petitZoomOut;
    delete win.__petitFitMap;
    delete win.__petitCaptureFullMap;
    delete win.__petitShowPreview;
    delete win.__petitClearPreview;
    delete win.__petitGetViewport;
    delete win.__petitAnimateRemove;
    delete win.__petitAnimateRotation;
    delete win.__petitFlashCommit;
    delete win.__petitResyncObjects;
    delete win.__petitGetCamera;
    delete win.__petitSetCamera;
  };
}
