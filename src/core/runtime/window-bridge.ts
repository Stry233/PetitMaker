/*
 * window-bridge.ts — the typed surface of the `window.__petit*` bridge.
 *
 * PixiCanvas (and a couple of other producers) publish imperative hooks on
 * `window` so React chrome can drive the canvas without prop-drilling through
 * the renderer. This module declares each hook ONCE with its real signature,
 * derived from the assigning site, so every consumer shares one cast and one
 * shape instead of re-inventing it inline:
 *
 *   - renderer/PixiCanvas.tsx: __petitZoomIn/Out, __petitFitMap,
 *     __petitShowPreview, __petitClearPreview,
 *     __petitGetViewport, __petitAnimateRemove, __petitAnimateRotation,
 *     __petitFlashCommit, __petitResyncObjects, __petitGetCamera, __petitSetCamera
 *   - canvas/map3d/interaction/window-bridge-register.ts: __petitGet3DCamera,
 *     __petitSet3DCamera (the 3D orbit-camera twin of the 2D pair above)
 *   - ui/hooks/useRegionBrush.ts: __petitRegionBrushCallback/Done
 *     (set to null — not undefined — when region selection is off)
 *
 * Every hook is optional: it may be absent before the producer mounts (or
 * after it unmounts), so call sites must keep optional-call semantics
 * (`petitWindow().__petitZoomIn?.()`).
 */
import type { MacroCoord } from '../model/types';

/** The slice of the Pixi viewport the React chrome reads (screen anchoring). */
export interface ViewportLike {
  macroToScreen: (c: { x: number; y: number }) => { x: number; y: number };
  getZoom: () => number;
}

export interface PetitBridge {
  /* renderer/PixiCanvas.tsx */
  __petitZoomIn?: () => void;
  __petitZoomOut?: () => void;
  __petitFitMap?: () => void;
  __petitCaptureFullMap?: (maxPx?: number, includeGrid?: boolean) => string | null;
  __petitShowPreview?: (cells: MacroCoord[]) => void;
  __petitClearPreview?: () => void;
  __petitGetViewport?: () => ViewportLike | undefined;
  __petitAnimateRemove?: (id: string) => void;
  __petitAnimateRotation?: (id: string, fromDeg: number, toDeg: number) => void;
  __petitFlashCommit?: (cells: MacroCoord[], opts?: { color?: number; terrainMode?: boolean }) => void;
  __petitResyncObjects?: () => void;
  /** Camera read/write for the JSON-import session section (io/import-sections.ts).
   *  {x, y} is the viewport's raw pixel offset (Viewport.getOffset()), not world macro coords. */
  __petitGetCamera?: () => { x: number; y: number; zoom: number } | undefined;
  __petitSetCamera?: (c: { x: number; y: number; zoom: number }) => void;

  /* canvas/map3d/interaction/window-bridge-register.ts. The 3D twin of the pair above: an
   *  orbit-camera framing (az/el/dist + an optional target offset) rather than a pan/zoom offset.
   *  Reports/accepts undefined-safely across the 3D editor's lazy mount: __petitGet3DCamera is
   *  only meaningful once a scene has been BUILT FOR THE CURRENT map (a stale scene from a
   *  previously loaded map reports undefined rather than a camera that doesn't belong to it), and
   *  __petitSet3DCamera queues the angle for the scene's next construction when none exists yet. */
  __petitGet3DCamera?: () => { az: number; el: number; dist: number; tx?: number; tz?: number } | undefined;
  __petitSet3DCamera?: (c: { az: number; el: number; dist: number; tx?: number; tz?: number }) => void;

  /* ui/hooks/useRegionBrush.ts (PixiCanvas invokes these on pointer move/up) */
  __petitRegionBrushCallback?: ((coord: MacroCoord) => void) | null;
  __petitRegionBrushDone?: (() => void) | null;
}

/** Typed accessor for the `__petit*` bridge hooks on `window`. */
export function petitWindow(): PetitBridge {
  return window as unknown as PetitBridge;
}
