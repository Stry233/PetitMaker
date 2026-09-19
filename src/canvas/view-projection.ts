/**
 * The seam between the tool/interaction layer and a concrete map view. Tools,
 * the ToolManager, and the pointer machine speak ONLY these interfaces, so a
 * second renderer (the 3D editor) plugs in by implementing them — the tool
 * codebase itself never branches on which view is live.
 *
 * 2D: `Viewport` satisfies ViewProjection, `OverlayLayer` satisfies ToolOverlay.
 * 3D: the projection raycasts the visible surface to a cell; the overlay draws
 * surface decals. Both views convert cells to screen coordinates for the
 * screen-anchored React chrome (SelectionHandles / ContextMenu / popovers).
 */
import type { GridState, MacroCoord, PlacedObject } from '../core/model/types';
import type { GhostPaint } from '../core/runtime/preview-cell';
import type { TrimmedCell } from '../tools/edge-cut';
import type { RowSpan } from './map2d/layers/ghost-geometry';
import type { MacroRect } from './interaction/marquee';
import type { GroupRotation } from './group-arc';

export interface ViewProjection {
  /** Macro cell under a screen point (2D: inverse camera transform; 3D: visible-surface pick). */
  screenToMacro(sx: number, sy: number): MacroCoord;
  /** Micro (half-cell) coordinate under a screen point. */
  screenToMicro(sx: number, sy: number): MacroCoord;
  /** The half-cell grid point NEAREST a screen point (round(2·world)/2 per axis) — the sub-cell
   *  precision `screenToMacro`'s floor discards, needed only by a `halfStep` item's ghost/click/
   *  drag anchor (see `state/object-geometry:snapAnchor`). Optional: a view/mock without it leaves
   *  half-grid placement at whatever `screenToMacro` already gives (the whole-cell grid). */
  screenToHalf?(sx: number, sy: number): MacroCoord;
  /** Screen position of macro cell (x, y)'s corner + the projected cell size in px. `behind` marks a
   *  point at or behind the camera plane: a perspective divide by a negative w mirrors x/y, so the
   *  returned coords are finite but WRONG. Chrome that anchors to a point must hide on it (a flat 2D
   *  camera has no behind, and omits the flag). */
  cellToScreen(x: number, y: number): { x: number; y: number; scale: number; behind?: boolean };
  /** Camera verb used by the Hand tool (2D: offset pan; 3D: ground-plane pan). */
  pan(dx: number, dy: number): void;
  /** Object under the pointer by its RENDERED body (3D: mesh raycast — a tree's
   *  canopy selects the tree). Null falls back to footprint hit-testing. */
  pickObject?(sx: number, sy: number): string | null;
  /** Camera-facing annotation labels use their rendered screen bounds, including a miss. */
  pickAnnotationLabel?(sx: number, sy: number): string | null;
  annotationLabelBox?(id: string): { x: number; y: number; w: number; h: number } | null;
  /** Screen bounds of an object's body, or its surface footprint without a body. */
  objectScreenBox?(id: string): { x: number; y: number; w: number; h: number } | null;
}

/** The drawing surface tools and the pointer machine paint feedback through.
 *  Cell coordinates; `terrainMode`/`terrainGrid` selects the micro grid
 *  (−HALF_TILE) that terrain renders on, vs the macro grid objects use. */
export interface ToolOverlay {
  /** `trim` is what auto-trim will do to the shape — the ghost draws the corners it will actually
   *  have, plus any Γ patch the trim fills a notch with, or (for a road stroke) the cut end-caps
   *  and bends the paving will leave, each entry naming the side it connects on. Views without
   *  trimmed shapes ignore it and draw squares; the cell set still carries the footprint. */
  /** `losses` is what the shape would COST: cells whose coating this lay would replace, and cells a
   *  hand-placed planting holds that the run will refuse rather than take. Drawn in the warning
   *  tint beside the gain wash, so a ghost shows both halves of the press. */
  /** `paint` is either a plain tint (a placement wash) or the PREVIEW CARD the build tools draw —
   *  see `core/runtime/preview-cell` for the card's geometry and its two palettes. */
  showGhost(cells: MacroCoord[], paint: GhostPaint, terrainGrid?: boolean, trim?: readonly TrimmedCell[], losses?: readonly MacroCoord[]): void;
  showGhostSpans(spans: RowSpan[], paint: GhostPaint, terrainGrid?: boolean, trim?: readonly TrimmedCell[]): void;
  clearGhost(): void;
  /** An editable curve footprint, independent of transient pointer previews. */
  showCurveFootprint(cells: MacroCoord[], terrainGrid: boolean): void;
  clearCurveFootprint(): void;
  /** `append` draws this ring alongside whatever is already on screen instead of replacing it
   *  (a GROUP selection paints one ring per member). Omit or false replaces. */
  showSelection(x: number, y: number, w?: number, h?: number, elevation?: number, terrainMode?: boolean, append?: boolean): void;
  clearSelection(): void;
  showHover(x: number, y: number, w?: number, h?: number, terrainMode?: boolean): void;
  clearHover(): void;
  /** A cell may name its OWN grid (`micro`), overriding `terrainMode` for itself: one undo step can
   *  hold a terrain change and an object change, and the two render half a cell apart. With
   *  neither stated, both views fall back to the TERRAIN grid — a bare cell list names grid cells. */
  flashCommit(cells: readonly (MacroCoord & { micro?: boolean })[], opts?: { color?: number; terrainMode?: boolean }): void;
  showBuildableRegion(cells: MacroCoord[], terrainMode: boolean): void;
  clearBuildableRegion(): void;
  /**
   * The standing region breathing once: it dips to `1 - dip` of its own opacity and comes back,
   * over `durationMs`. Nothing new arrives beside it, because what it says is "this line, the one
   * already on your map, is the reason the last edit was refused".
   *
   * OPTIONAL FOR THE DOUBLES ONLY: both live views implement it. A caller reaches it through
   * `kit/host.ts`, which owns the numbers (they are declared in the motion registry).
   */
  pulseBuildableRegion?(durationMs: number, dip: number): void;
  /** The maze's answer, draped over the corridor floor: its own drape, so it can stand at the same
   *  time as the buildable-region one. Drawn on the TERRAIN grid (−HALF_TILE): walls render
   *  shifted up-left, so the visible corridor between two walls is the corridor cell's
   *  terrain-shifted rect — a macro rect would slide half a tile under the walls. */
  showRoute(cells: MacroCoord[]): void;
  clearRoute(): void;
  /** The Ctrl+drag rubber band, in the same MACRO rect it selects with. Never terrain-shifted:
   *  a band only ever selects objects. */
  showBand(rect: MacroRect): void;
  clearBand(): void;
  /** 3D enhancement: an object-bounding selection box (wireframe around the
   *  rendered body); views without one use the flat footprint ring. Cleared by
   *  clearSelection. `append` behaves as in showSelection. */
  showObjectSelection?(objectId: string, append?: boolean): void;
  /** 3D enhancement: the item's actual mesh, translucent and validity-tinted,
   *  at the hover cell. Views without a mesh representation omit it; callers
   *  pair it with the cell ghost (which carries the footprint/validity). */
  showPlacementGhost?(catalogId: string, x: number, y: number, rotation: number, valid: boolean, elevation: number): void;
  /** Preview solid objects at their destinations and mark their origins. Cleared by clearGhost. */
  showObjectMove?(destinations: readonly PlacedObject[], valid: boolean): void;
  /** The GROUP drag ghost: one body per selected member, each at its own drop position, ALL
   *  sharing ONE validity tint — a group move is all-or-nothing, so tinting members individually
   *  would promise a partial move that can never happen. Views without a body-ghost representation
   *  omit it (same fallback as `showPlacementGhost`); the cell wash from `showGhost` still carries
   *  the footprint/validity on its own. Replaces whatever the last call drew. */
  showGroupPlacementGhost?(members: Array<{
    catalogId: string; x: number; y: number; rotation: number; elevation: number;
  }>, valid: boolean): void;
}

/** One editable view (2D map or 3D editor): the projection + overlay pair plus
 *  the view-specific hooks the tool layer needs. ToolManager holds the ACTIVE
 *  view and is re-pointed when the mode toggles. */
export interface EditorView {
  projection: ViewProjection;
  overlay: ToolOverlay;
  /** Re-apply the camera after a camera verb (the Hand tool's pan loop). */
  applyCameraTransform(): void;
  /** Placement "plop" animation for a freshly placed object (view-specific, optional). */
  plopObject?(id: string): void;
  /** Rotation spin animation (view-specific, optional). One object turning about its OWN centre.
   *  `onFrame`, when supplied, fires once per tick with the SAME eased progress just applied to the
   *  icon/instance (1 on the settling frame, never called under reduced motion) — the caller's hook
   *  for keeping the selection ring on the same clock instead of interpolating the turn a second time. */
  animateRotation?(id: string, fromDeg: number, toDeg: number, onFrame?: (eased: number) => void): void;
  /** A GROUP rotation: one rigid body turning about one point, so it arrives as ONE spec covering
   *  every member (never a spin per member — see `group-arc.ts` for the arc + one-clock invariants).
   *  Optional, like the tweens above; a view without it simply shows the finished arrangement.
   *  `onFrame` is the same per-tick progress hook as `animateRotation` above, fired once per tick
   *  (not once per member) since the whole body shares one clock. */
  animateGroupRotation?(turn: GroupRotation, onFrame?: (eased: number) => void): void;
  /** Collapse animation for an object about to be removed (view-specific, optional). Runs BEFORE the
   *  command: the removal emits `objects-changed` synchronously and the view destroys the body, so
   *  there is nothing left to animate afterwards. */
  animateRemove?(id: string): void;
  /** The map this view currently RENDERS. Not the same as the store's `gridState`: a freshly loaded
   *  map reaches each view on that view's own schedule (the 3D scene is rebuilt behind an async
   *  import, so for a while the registered view still shows the previous map). A caller that must
   *  know "has the view caught up to this map yet" asks here. Views that cannot report it omit it. */
  rendersState?(): GridState | null;
  /** One-shot: run `cb` after the next frame this view actually PAINTS. Both views draw ON DEMAND,
   *  so "a frame passed" is not "the map is on screen" — only the renderer knows when it drew. Fires
   *  on teardown too (a disposed view will never paint, and a waiter must never hang). Views that
   *  cannot report it omit it. */
  onNextPaint?(cb: () => void): void;
  /** Whether the Hand tool's LEFT-drag pans the camera. The 2D map keeps its
   *  classic grab-the-map drag; the 3D editor reserves left strictly for
   *  selection and tools (there, right/middle drag orbit and pan lives on
   *  left-drag in Hand mode, Space+left-drag, or WASD). */
  leftDragPans?: boolean;
}

/** Camera verbs the pointer machine drives. Each verb SELF-APPLIES (no
 *  separate transform call): 2D = viewport offset/zoom, 3D = orbit camera. */
export interface ViewCamera {
  pan(dx: number, dy: number): void;
  /** Stepped zoom at a screen anchor (a discrete mouse notch). */
  zoomStep(dir: 1 | -1, anchorX: number, anchorY: number): void;
  /** Stepped zoom for the toolkit buttons, EASED (a camera glide) rather than
   *  instant. Optional: the 2D chrome runs its own tween, so only the 3D view
   *  implements this; callers fall back to zoomBy when it's absent. */
  zoomStepAnimated?(dir: 1 | -1): void;
  /** Smooth magnitude zoom (pinch / ctrl+wheel), factor > 1 zooms in. */
  zoomBy(factor: number, anchorX: number, anchorY: number): void;
  /** Orbit by screen deltas — 3D only. The machine's right-drag calls
   *  orbit ?? pan, so the 2D view pans where the 3D view orbits. */
  orbit?(dx: number, dy: number): void;
  /** The drag that was moving the camera has ended. A view with inertia coasts from the velocity
   *  its pan/orbit verbs were carrying; a view without one omits this and stops dead. */
  endGesture?(): void;
  /** Re-frame the whole map (the fit chrome/shortcut). */
  fitToMap?(): void;
  /** Two-finger twist → yaw, radians (3D only). */
  orbitTwist?(dRadians: number): void;
  /** Camera tilt as 0..1 across the view's polar range (3D only). */
  tilt?(value: number): void;
  /** When true, a touchpad two-finger scroll ZOOMS (dolly) instead of panning.
   *  The 3D camera sets this: a scroll-pan there would slide the camera forward/
   *  back (reads as W/S), so scroll should zoom. The 2D view leaves it unset and
   *  keeps touchpad-scroll panning. (A mouse notch always zooms in both views.) */
  wheelZooms?: boolean;
}

/** The full contract one view hands the pointer machine. */
export interface ActiveView extends EditorView {
  camera: ViewCamera;
}
