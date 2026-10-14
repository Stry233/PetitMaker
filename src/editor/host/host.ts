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
import { showBuildableRegion, clearBuildableRegion, showPath, clearPath } from '../../view/shared/overlay/overlay-view-sync';
import { getActiveView } from '../../view/active-view';
import { getMapRenderer } from '../../view/map2d/scene/renderer-registry';
import { get3DCamera, set3DCamera } from '../../view/map3d/scene/renderer-registry';
import type { CameraAngle, View2dCamera, ViewCameras } from '../../state/view-camera';
import { paintSpinRing } from '../../view/shared/overlay/selection-paint';
import { singleSelection } from '../../state/selection';
import { useEditorStore } from '../../state/store';
import { layerNumbersShown } from '../../state/layer-utils';
import type { GridState, MacroCoord } from '../../core/model/types';
import { captureMapStills } from '../../view/map3d/capture/stills';
import type { Rect } from '../../core/grid/rect';
import type { PlanetFrame } from '../../core/model/planet';
import type { CellSet } from '../../core/grid/grids';
import type { MapCaptureOptions } from '../../view/map-capture';
import { parkCameras, takeParkedCameras } from '../../view/shared/viewport/parked-camera';

/** The capture side assumed with no 2D view to ask: one every WebGL device renders. */
const SAFE_TEXTURE_SIDE = 4096;

/** The slice of the 2D viewport a macro-to-screen projection needs. React chrome anchors through
 *  `getActiveView().projection` instead (it works in both 2D and 3D); this is for a caller outside
 *  the view seam that specifically wants the 2D viewport, such as a script framing a capture. */
interface ViewportLike {
  macroToScreen: (c: MacroCoord) => { x: number; y: number };
  getZoom: () => number;
}

export const host = {
  camera: {
    zoomIn(): void { getActiveView()?.camera.zoomStepAnimated(1); },
    zoomOut(): void { getActiveView()?.camera.zoomStepAnimated(-1); },
    /** Turns the camera as a drag of `dx`, `dy` screen px would, in the views that turn. */
    orbit(dx: number, dy: number): void { getActiveView()?.camera.orbit?.(dx, dy); },
    fit(): void { getActiveView()?.camera.fitToMap(); },
    get2d(): View2dCamera | undefined {
      const vp = getMapRenderer()?.viewport;
      if (!vp) return undefined;
      const v = vp.getView();
      return { x: v.offsetX, y: v.offsetY, zoom: v.zoom };
    },
    set2d(c: View2dCamera): void {
      const r = getMapRenderer();
      if (!r) return;
      r.viewport.setView({ zoom: c.zoom, offsetX: c.x, offsetY: c.y });
      r.applyViewportTransform();
    },
    get3d(): CameraAngle | undefined { return get3DCamera(); },
    set3d(c: CameraAngle): void { set3DCamera(c); },
    /** Parks a camera for each view on the installed map, replacing any waiting there; each view
     *  takes its pose when it draws that map (`view/shared/viewport/parked-camera.ts`). */
    queue(c: ViewCameras | null): void {
      const state = useEditorStore.getState().gridState;
      if (state) parkCameras(state, c);
    },
    /** Takes what waits for the installed map, leaving nothing for the views. */
    takeQueued(): ViewCameras | null {
      const state = useEditorStore.getState().gridState;
      return state ? takeParkedCameras(state) : null;
    },
  },
  feedback: {
    /** One commit acknowledgement over `sets`, each on the grid its caller names. */
    flash(sets: readonly CellSet[], opts?: { color?: number }): void {
      getActiveView()?.overlay.flashCommit(sets, opts);
    },
    plop(id: string): void { getActiveView()?.plopObject(id); },
    spin(id: string, from: number, to: number): void {
      // The ring rides the same per-tick progress the icon/instance gets (see
      // view/shared/overlay/selection-paint.ts:paintSpinRing) — only repainted while `id` is still the live single selection, so a rotate
      // fired from a stale/closed-over id never redraws a ring for something the user isn't looking at.
      const onFrame = (eased: number) => {
        const view = getActiveView();
        const s = useEditorStore.getState();
        if (!view || !s.gridState) return;
        const sel = singleSelection(s.selection);
        if (sel?.kind === 'object' && sel.id === id) {
          paintSpinRing(view.overlay, s.gridState, id, eased, layerNumbersShown(s));
        }
      };
      getActiveView()?.animateRotation(id, from, to, onFrame);
    },
    poof(id: string): void { getActiveView()?.animateRemove?.(id); },
  },
  buildableRegion: {
    show(cells: MacroCoord[], dimensionScale?: number): void { showBuildableRegion(cells, dimensionScale); },
    clear(): void { clearBuildableRegion(); },
    /** The standing region breathing once, as its own answer to "why was that refused": the caller
     *  brings the numbers, since a duration is declared in the motion registry and nowhere else. */
    pulse(durationMs: number, dip: number): void {
      getActiveView()?.overlay.pulseBuildableRegion(durationMs, dip);
    },
  },
  planetFrame: {
    show(frame: PlanetFrame | null): void { getActiveView()?.overlay.showFrame?.(frame); },
    /** The caller brings the duration, which the motion registry declares. */
    flash(durationMs: number): void { getActiveView()?.overlay.flashFrame?.(durationMs); },
  },
  planetReview: {
    /** A scanned planet's cells to check and the outline of the landmark's footprint; null cells
     *  take them down. */
    show(cells: CellSet | null, outline: Rect | null = null): void { getActiveView()?.overlay.showCellMarks?.(cells, outline); },
  },
  route: {
    show(cells: CellSet): void { showPath(cells); },
    clear(): void { clearPath(); },
  },
  /** A 2D capture as `options` describe it (`view/map-capture.ts`), or null with no 2D view. */
  capture2d(options?: MapCaptureOptions): HTMLCanvasElement | null {
    return getMapRenderer()?.capture(options) ?? null;
  },
  /** `capture2d` as a PNG data URL. */
  capture2dImage(options?: MapCaptureOptions): string | null {
    return getMapRenderer()?.captureImage(options) ?? null;
  },
  /** Longest side one 2D capture may have on this GPU. */
  capture2dTextureCap(): number {
    return getMapRenderer()?.textureCap() ?? SAFE_TEXTURE_SIDE;
  },
  capture3dStills(state: GridState, angles: CameraAngle[] | undefined, opts: { maxPx?: number; aspect?: number }): Promise<string[]> {
    return captureMapStills(state, angles, opts);
  },
  /** See `ViewportLike` — a caller outside the view seam only; React chrome uses the active view's
   *  own projection instead. */
  viewport2d(): ViewportLike | undefined { return getMapRenderer()?.viewport; },
  resync(): void { getMapRenderer()?.resyncObjects(); },
};
