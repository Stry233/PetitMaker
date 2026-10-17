/**
 * The seam between the tools and a concrete map view, declared here because `tools` ranks below
 * `view`: tools, the tool manager and the pointer machine speak only these interfaces, and each
 * view implements them, so no tool branches on which view is live.
 *
 * 2D: `Viewport` satisfies ViewProjection, `OverlayLayer` satisfies ToolOverlay.
 * 3D: the projection raycasts the visible surface to a cell; the overlay draws
 * surface decals. Both views convert cells to screen coordinates for the
 * screen-anchored React chrome (SelectionCard / ContextMenu / popovers).
 */
import type { GridState, PlacedObject } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import type { CellSet, GridCell, GridCellRef, GridId, MapPoint, MixedCellSet } from '../../../core/grid/grids';
import type { TrimmedCell } from '../../trim/trim-preview';
import type { RowSpan } from '../../../core/grid/cell-spans';
import type { GroupRotation } from '../../objects/group-rotation';
import type { PlanetFrame } from '../../../core/model/planet';
import type { MapAnnotation } from '../../../core/model/annotations';

/** The glyph a preview card carries: the four content glyphs plus the two tool glyphs the design
 *  draws. Each view draws them from its own art. */
export type PreviewIcon = 'ground' | 'mountain' | 'water' | 'eraser' | 'trim';

/**
 * What a ghost is asking for: the preview card, in the state the operation is in.
 *
 * `icon` names the glyph the card carries: what is being laid (ground/road, mountain, water) or
 * which tool is acting (eraser, trim), and `null` is a card with no glyph at all, which is what
 * smart planting shows (a macro lays a composition, not one surface).
 */
export interface PreviewCell {
  icon: PreviewIcon | null;
  /** Whether the operation would be accepted here (the tool's own `canActAt` answer). */
  valid: boolean;
}

/** A placement's wash: the footprint tinted by whether the drop would be accepted. */
export interface PlacementWash {
  wash: 'placement';
  valid: boolean;
}

/** A ghost's paint: a placement wash or the preview card. A tool reports validity; the view colours it. */
export type GhostPaint = PlacementWash | PreviewCell;

export interface ViewProjection {
  /** The map point under a screen point, in cells and unrounded (2D: inverse camera transform; 3D:
   *  visible-surface pick, else the ground plane). Which cell holds it depends on the grid asking,
   *  so cells are resolved from this point (`core/grid/pointer.ts`), never by the view. */
  screenToPoint(sx: number, sy: number): MapPoint;
  /** Screen position of macro cell (x, y)'s corner + the projected cell size in px. `behind` marks a
   *  point at or behind the camera plane: a perspective divide by a negative w mirrors x/y, so the
   *  returned coords are finite but wrong. Chrome that anchors to a point must hide on it (a flat 2D
   *  camera has no behind, and omits the flag). */
  cellToScreen(x: number, y: number): { x: number; y: number; scale: number; behind?: boolean };
  /** From a press until its release, `screenToPoint` reads the surface as it stood when the press
   *  began, so terrain the press itself builds or removes never moves the pointer onto other cells. A
   *  view whose pointer point does not depend on the terrain (2D) leaves these out. */
  holdSurface?(): void;
  releaseSurface?(): void;
  /** Object under the pointer by its rendered body (3D: mesh raycast — a tree's
   *  canopy selects the tree). Null falls back to footprint hit-testing. */
  pickObject?(sx: number, sy: number): string | null;
  /** Camera-facing annotation labels use their rendered screen bounds, including a miss. */
  pickAnnotationLabel?(sx: number, sy: number): string | null;
  annotationLabelBox?(id: string): { x: number; y: number; w: number; h: number } | null;
  /** Screen bounds of an object's body, or its surface footprint without a body. */
  objectScreenBox?(id: string): { x: number; y: number; w: number; h: number } | null;
}

/** A ghost cell: a cell of the ghost's own grid `G`, or one naming its own grid. */
export type GhostCell<G extends GridId = GridId> = GridCell<G> | GridCellRef;

/** The latest ghost a view was asked to draw, held until its next frame rebuilds it. */
export type GhostRequest =
  | { kind: 'cells'; cells: readonly GhostCell[]; paint: GhostPaint; grid: GridId; trim?: readonly TrimmedCell[]; losses?: readonly GhostCell[] }
  | { kind: 'spans'; spans: RowSpan[]; paint: GhostPaint; grid: GridId; trim?: readonly TrimmedCell[] }
  | { kind: 'clear' };

/** The drawing surface tools and the pointer machine paint feedback through. Positions are in cells,
 *  and every call names the grid its cells lie on (`core/game/profile.ts:GRIDS`). */
export interface ToolOverlay {
  /** `trim` is what auto-trim will do to the shape: the corners, Γ patches or road end caps and
   *  bends it will leave, each naming the side it connects on; views without trimmed shapes draw
   *  squares. `losses` is what the press would cost (coatings replaced, plantings refused), drawn in
   *  the warning tint beside the gain wash. `paint` is a placement wash or the preview card
   *  ; either reports validity and the view picks the colour.
   *  A cell may name its own grid, since one macro run changes terrain and objects at once; trim
   *  and card belong to the ghost's own grid, and cells on another grid draw as a plain footprint. */
  showGhost(cells: MixedCellSet, paint: GhostPaint, trim?: readonly TrimmedCell[], losses?: readonly GhostCell[]): void;
  showGhostSpans(spans: RowSpan[], paint: GhostPaint, grid: GridId, trim?: readonly TrimmedCell[]): void;
  clearGhost(): void;
  /** An editable curve footprint, independent of transient pointer previews. */
  showCurveFootprint(cells: CellSet): void;
  clearCurveFootprint(): void;
  /** `append` draws this ring alongside whatever is already on screen instead of replacing it
   *  (a group selection paints one ring per member). Omit or false replaces. `exact` marks a regular,
   *  flat body (a road) with its exact box, as terrain always is. */
  showSelection(rect: Rect, grid: GridId, opts?: SelectionOpts): void;
  clearSelection(): void;
  showHover(rect: Rect, grid: GridId): void;
  clearHover(): void;
  /** One acknowledgement over every set, each on its own grid: one undo step can hold a terrain
   *  change and an object change, and the two lie on different grids. */
  flashCommit(sets: readonly CellSet[], opts?: { color?: number }): void;
  showBuildableRegion(cells: CellSet, dimensionScale?: number): void;
  clearBuildableRegion(): void;
  /**
   * The standing region breathing once: it dips to `1 - dip` of its own opacity and comes back,
   * over `durationMs`. Nothing new arrives beside it, because what it says is "this line, the one
   * already on your map, is the reason the last edit was refused".
   *
   * Callers reach it through `editor/host/host.ts`, which owns the numbers from the motion registry.
   */
  pulseBuildableRegion(durationMs: number, dip: number): void;
  /** A frame outline around a block of chunks (the planet session's extent); null takes it down.
   *  2D only. */
  showFrame?(frame: PlanetFrame | null): void;
  /** The frame flashing once over `durationMs` (the caller brings the registry's number). A flash
   *  already running is left to finish. */
  flashFrame?(durationMs: number): void;
  /** Hatched cells to look at and an optional footprint outline (a scanned planet's review); null
   *  cells take both down. 2D only. */
  showCellMarks?(cells: CellSet | null, outline: Rect | null): void;
  /** Objects standing where they may not, each drawn whole above the landmarks with the loss red;
   *  null takes them down. */
  showFlaggedObjects?(objects: readonly PlacedObject[] | null): void;
  /** A path draped over cells (the maze's answer), its own drape so it can stand beside the
   *  buildable region. */
  showPath(cells: CellSet): void;
  clearPath(): void;
  /** The Ctrl+drag rubber band, in the same placement-grid rect it selects with: a band only ever
   *  selects objects. */
  showBand(rect: Rect): void;
  clearBand(): void;
  /** 3D enhancement: a selection box bounding the rendered body. A view without one, and a lone
   *  road in any view, use the footprint ring from `showSelection`. Cleared by clearSelection;
   *  `append` behaves as in showSelection. */
  showObjectSelection?(objectId: string, append?: boolean): void;
  /** The item itself (3D: its mesh, 2D: its sprite), translucent and validity-tinted, at the hover
   *  cell; callers pair it with the cell ghost, which carries the footprint and validity. */
  showPlacementGhost(ghost: PlacementGhost, valid: boolean): void;
  /** A drag-to-move's drop preview: the moved objects at their destinations, sharing one validity
   *  tint, since a group move is all-or-nothing (3D moves the bodies themselves and marks their
   *  origins, 2D draws placement ghosts). Cleared by clearGhost. */
  showObjectMove(destinations: readonly PlacedObject[], valid: boolean): void;
  /** One body per member at its own position, all sharing one validity tint (the group form of
   *  `showPlacementGhost`). Replaces whatever the last call drew. */
  showGroupPlacementGhost(members: readonly PlacementGhost[], valid: boolean): void;
  /** The note the next press would lay (a measurement end, a route point or segment, a tag chip),
   *  drawn as the notes layer draws it at a ghost's strength; `label` is a chip's drawn tag text.
   *  Replaces whatever the last call drew; cleared by clearGhost. */
  showNoteGhost(note: MapAnnotation, label: string): void;
}

/** One body a placement ghost shows: the item at its anchor cell, turned and standing at the
 *  elevation the placement gives it; a span item carries its span length. */
export interface PlacementGhost {
  catalogId: string; x: number; y: number; rotation: number; elevation: number; spanLength?: number;
}

/** A selection ring's options: the elevation it labels, whether it joins the rings already shown,
 *  and whether it marks a flat body's exact box. */
export interface SelectionOpts { elevation?: number; append?: boolean; exact?: boolean }

/** One editable view (2D map or 3D editor): the projection + overlay pair plus
 *  the view-specific hooks the tool layer needs. ToolManager holds the active
 *  view and is re-pointed when the mode toggles. */
export interface EditorView {
  projection: ViewProjection;
  overlay: ToolOverlay;
  /** Placement "plop" animation for a freshly placed object. */
  plopObject(id: string): void;
  /** Rotation spin animation: one object turning about its own centre.
   *  `onFrame`, when supplied, fires once per tick with the same eased progress just applied to the
   *  icon/instance (1 on the settling frame, never called under reduced motion) — the caller's hook
   *  for keeping the selection ring on the same clock instead of interpolating the turn a second time. */
  animateRotation(id: string, fromDeg: number, toDeg: number, onFrame?: (eased: number) => void): void;
  /** A group rotation: one rigid body turning about one point, so it arrives as one spec covering
   *  every member (never a spin per member — see `group-arc.ts` for the arc + one-clock invariants).
   *  `onFrame` is the same per-tick progress hook as `animateRotation` above, fired once per tick
   *  (not once per member) since the whole body shares one clock. */
  animateGroupRotation(turn: GroupRotation, onFrame?: (eased: number) => void): void;
  /** Collapse animation for an object about to be removed (view-specific, optional). Runs before the
   *  command: the removal's `objects-changed`, at once or when its transaction closes, has the view
   *  destroy the body, so there is nothing left to animate afterwards. */
  animateRemove?(id: string): void;
  /** The map this view currently renders. Not the same as the store's `gridState`: a freshly loaded
   *  map reaches each view on that view's own schedule (the 3D scene is rebuilt behind an async
   *  import, so for a while the registered view still shows the previous map). A caller that must
   *  know "has the view caught up to this map yet" asks here. */
  rendersState(): GridState | null;
  /** One-shot: run `cb` after the next frame this view actually paints. Both views draw on demand,
   *  so "a frame passed" is not "the map is on screen" — only the renderer knows when it drew. Fires
   *  on teardown too (a disposed view will never paint, and a waiter must never hang). */
  onNextPaint(cb: () => void): void;
}

/** Camera verbs the pointer machine drives. Each verb self-applies (no
 *  separate transform call): 2D = viewport offset/zoom, 3D = orbit camera. */
export interface ViewCamera {
  pan(dx: number, dy: number): void;
  /** Stepped zoom at a screen anchor (a discrete mouse notch). */
  zoomStep(dir: 1 | -1, anchorX: number, anchorY: number): void;
  /** Stepped zoom for the camera buttons, eased (a camera glide) rather than instant. */
  zoomStepAnimated(dir: 1 | -1): void;
  /** Smooth magnitude zoom (pinch / ctrl+wheel), factor > 1 zooms in. */
  zoomBy(factor: number, anchorX: number, anchorY: number): void;
  /** Orbit by screen deltas — 3D only. The machine's right-drag calls
   *  orbit ?? pan, so the 2D view pans where the 3D view orbits. */
  orbit?(dx: number, dy: number): void;
  /** The drag that was moving the camera has ended. A view with inertia coasts from the velocity
   *  its pan/orbit verbs were carrying; a view without one omits this and stops dead. */
  endGesture?(): void;
  /** Re-frame the whole map, eased (the fit control and shortcut). */
  fitToMap(): void;
  /** Two-finger twist → yaw, radians (3D only). */
  orbitTwist?(dRadians: number): void;
  /** Camera tilt as 0..1 across the view's polar range (3D only). */
  tilt?(value: number): void;
}

/** The full contract one view hands the pointer machine. */
export interface ActiveView extends EditorView {
  camera: ViewCamera;
}
