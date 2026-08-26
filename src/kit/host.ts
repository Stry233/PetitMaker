/**
 * What a shell can ask of the map view.
 *
 * Every verb resolves against the view that is currently showing, so the same call works in 2D and
 * 3D. The two that cannot are named for it: capturing the whole map and reconciling the object
 * layer are the 2D renderer's, which is what the export pipeline runs on.
 *
 * A verb with no view to reach is a no-op. Both canvases unmount and remount, and a shell must not
 * have to know when.
 */
import { getActiveView } from '../canvas/active-view';
import { animateCamera, type CameraTweenHandle } from '../canvas/map2d/interaction/camera-tween';
import { getMapRenderer } from '../canvas/map2d/renderer-registry';
import { get3DCamera, set3DCamera } from '../canvas/map3d/scene/camera-registry';
import type { CameraAngle } from '../canvas/map3d/capture';
import { paintSpinRing } from '../canvas/interaction/usePointerInteraction';
import { resolveCellsFlash } from '../canvas/map2d/layers/error-flash';
import { singleSelection } from '../state/selection';
import { useEditorStore } from '../state/store';
import type { MacroCoord } from '../core/model/types';
import { currentKit } from './context';

const screenCentre = (): [number, number] => [window.innerWidth / 2, window.innerHeight / 2];

/** The slice of the 2D viewport a macro-to-screen projection needs. React chrome anchors through
 *  `getActiveView().projection` instead (it works in both 2D and 3D); this is for a caller outside
 *  the view seam that specifically wants the 2D viewport, such as a script framing a capture. */
export interface ViewportLike {
  macroToScreen: (c: MacroCoord) => { x: number; y: number };
  getZoom: () => number;
}

/** The 2D chrome buttons ease the camera rather than jumping it; the tween's cancel lives here so a
 *  fresh press and a teardown can both stop the one in flight. */
const tween: CameraTweenHandle = { cancel: null };

/** A view that orbits does its own eased step; a flat 2D camera is tweened from here. */
function zoom(dir: 1 | -1): void {
  const v = getActiveView();
  const factor = dir === 1 ? 1.25 : 0.8;
  if (v?.camera.zoomStepAnimated) v.camera.zoomStepAnimated(dir);
  else if (v?.camera.orbit) v.camera.zoomBy(factor, ...screenCentre());
  else animateCamera(getMapRenderer(), tween, (r) => r.viewport.setZoom(r.viewport.getZoom() * factor, ...screenCentre()));
}

export const host = {
  camera: {
    zoomIn(): void { zoom(1); },
    zoomOut(): void { zoom(-1); },
    fit(): void {
      const v = getActiveView();
      if (v?.camera.fitToMap) { v.camera.fitToMap(); return; }
      const state = currentKit()?.state;
      if (!state) return;
      animateCamera(getMapRenderer(), tween, (r) => r.viewport.fitToMap(state.template.width, state.template.height));
    },
    get2d(): { x: number; y: number; zoom: number } | undefined {
      const vp = getMapRenderer()?.viewport;
      if (!vp) return undefined;
      const v = vp.getView();
      return { x: v.offsetX, y: v.offsetY, zoom: v.zoom };
    },
    set2d(c: { x: number; y: number; zoom: number }): void {
      const r = getMapRenderer();
      if (!r) return;
      r.viewport.setView({ zoom: c.zoom, offsetX: c.x, offsetY: c.y });
      r.applyViewportTransform();
    },
    get3d(): CameraAngle | undefined { return get3DCamera(); },
    set3d(c: CameraAngle): void { set3DCamera(c); },
  },
  feedback: {
    /**
     * A caller that does not name a grid gets one derived per cell from what stands there
     * (`resolveCellsFlash`) rather than a blanket default. The agent's write acknowledgement is
     * that caller, and its one list mixes terrain cells with the objects a place/scatter just
     * landed — so no single boolean is right for it, in either view.
     */
    flash(cells: MacroCoord[], opts?: { color?: number; terrainMode?: boolean }): void {
      const view = getActiveView();
      if (!view) return;
      const gs = opts?.terrainMode === undefined ? useEditorStore.getState().gridState : null;
      view.overlay.flashCommit(gs ? resolveCellsFlash(gs, cells) : cells, opts);
    },
    plop(id: string): void { getActiveView()?.plopObject?.(id); },
    spin(id: string, from: number, to: number): void {
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
      getActiveView()?.animateRotation?.(id, from, to, onFrame);
    },
    poof(id: string): void { getActiveView()?.animateRemove?.(id); },
  },
  buildableRegion: {
    show(cells: MacroCoord[]): void { getActiveView()?.overlay.showBuildableRegion(cells, true); },
    clear(): void { getActiveView()?.overlay.clearBuildableRegion(); },
    /** The standing region breathing once, as its own answer to "why was that refused": the caller
     *  brings the numbers, since a duration is declared in the motion registry and nowhere else. */
    pulse(durationMs: number, dip: number): void {
      getActiveView()?.overlay.pulseBuildableRegion?.(durationMs, dip);
    },
  },
  route: {
    show(cells: MacroCoord[]): void { getActiveView()?.overlay.showRoute(cells); },
    clear(): void { getActiveView()?.overlay.clearRoute(); },
  },
  capture2d(maxPx = 1024, includeGrid = false): string | null {
    return getMapRenderer()?.captureMapImage(maxPx, includeGrid) ?? null;
  },
  /** See `ViewportLike` — a caller outside the view seam only; React chrome uses the active view's
   *  own projection instead. */
  viewport2d(): ViewportLike | undefined { return getMapRenderer()?.viewport; },
  resync(): void { getMapRenderer()?.resyncObjects(); },
};
