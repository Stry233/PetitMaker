import type {
  MacroCoord, MicroCoord, ToolType, TerrainType, AutoEdgeCut, EraserShape,
  Command, ValidationError, ValidationResult, GridState,
} from '../../core/model/types';
import type { AnnotationsState, AnnotationTool, AnnotationZoneShape, MapAnnotation, TagId } from '../../core/model/annotations';
import type { ContentType } from '../../core/model/edit-mode';
import type { ToolOverlay, ViewProjection } from '../../canvas/view-projection';
import type { CursorId } from '../../core/runtime/cursor-spec';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import type { MacroContext } from '../macros/context';

export interface ToolContext {
  gridState: GridState;
  viewport: ViewProjection;
  overlay: ToolOverlay;
  /** The pointer's nearest half-cell grid point (`ViewProjection.screenToHalf`), refreshed for
   *  the SAME screen coordinates immediately before a tool method runs — the sub-cell precision
   *  `coord`'s macro int already discarded by flooring. Only a `halfStep` item's ghost/click reads
   *  this (see `tools/objects/object-placer.ts`); undefined in a headless/mocked context, where
   *  such an item falls back to `coord` (whole-cell) like everything else. */
  halfCoord?: MacroCoord;
  executeCommand: (cmd: Command) => ValidationResult;
  commitStroke: (strokeStartSize: number, opts?: { reconcile?: boolean }) => ValidationError[];
  validateCommand: (cmd: Command) => ValidationError[];
  /** The pre-command rules themselves, for asking about a HYPOTHETICAL grid rather than the live
   *  one — the auto-trim ghost, which runs the trim pass over a scratch copy before the click.
   *  `validateCommand` is this bound to `gridState`. */
  rules: RuleDispatcher;
  undo: () => void;
  getUndoStackSize: () => number;
  /** Fold history entries [start, top) into one undo step. ATOMIC UNDO: a stroke and its auto-trims
   *  fold into ONE undo entry — auto-trim and a gamma click's raise+trim are not user-visible
   *  operations, so they undo with the block step they belong to. */
  collapseHistory: (start: number) => void;
  /** Undo everything back to a watermark, exactly. For a stroke that has to be all-or-nothing:
   *  `commitStroke`'s auto-revert stops as soon as the state is legal, which can leave a multi-part
   *  stroke half-applied — right for a brush, wrong for one that rewrites a shape. */
  rollbackTo: (watermark: number) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Set the layer-panel highlight while auto-stacking (null → follow the
   *  selected layer). Does NOT change the build floor (ctx.elevation). */
  setDisplayLayer: (layer: number | null) => void;
  /** Trigger a placement "plop" (squash + dust) on a freshly point-placed object
   *  once its sprite exists; no-op for bulk adds. Optional — omitted in headless
   *  tests. */
  plopObject?: (id: string) => void;
  terrainType: TerrainType;
  elevation: number;
  /** Whether `elevation` was chosen by hand in the layer panel. The water brush paints at the
   *  pinned layer when it was, and at each cell's own surface when it was not. */
  layerPinned: boolean;
  brushSize: number;
  /** A painted region confines all support and crossings of a Smart Build gesture. */
  region?: readonly MacroCoord[];

  /**
   * THE EDITOR'S ARMING, mirrored per event by the manager that builds this context.
   *
   * A tool answers the pointer from what it is handed. Reaching past this into the store would make
   * every one of these a hidden argument: invisible in the signature, unmockable without seeding a
   * global, and free to differ between the probe that draws the cursor and the click that acts.
   */
  /** The surface the build bars are laying. The eraser erases its OWN surface. */
  contentType: ContentType;
  /** Which build floors are shown. A hidden layer is skipped, not refused. */
  layerVisibility: Readonly<Record<number, boolean>>;
  /** The corner-trim setting the Build panel holds. */
  autoEdgeCut: AutoEdgeCut;
  /** What one eraser gesture takes back: a dab, or a dragged rectangle/circle. */
  eraserShape: EraserShape;
  /** The road catalog id the tile brush lays. */
  tileMaterial: string;
  /** Whether a hand PICKED `tileMaterial` (`state/slices/edit.ts`). The road macros read the map's
   *  own surface when nobody has, so the bar's default never overrides what the island is paved
   *  with; a real pick always wins. */
  tileMaterialPicked: boolean;
  /** The armed catalog item, or null with nothing armed. */
  armedItem: string | null;
  /** The armed item's PENDING rotation, turned by the rotate shortcuts while its ghost shows. */
  placementRotation: 0 | 90 | 180 | 270;
  /** The armed macro's id, as a plain string — the catalogue lives above this layer. */
  armedMacro: string | null;
  /** How many times the armed macro has changed (`state/slices/edit.ts`). A tool holding state
   *  across a card switch compares this rather than the id, which a switch away and back restores. */
  armingEpoch: number;
  /**
   * The editor as the macro layer takes it (`macros/context.ts`). A macro runs the SAME code for
   * the shell, the agent's director tools and a test, and that code takes an executor rather than a
   * command sink — so the tool is handed one built from the same grid+executor pair this context
   * wraps, and a macro run from the map cannot diverge from one the agent runs.
   */
  macroContext: MacroContext;

  /** The plan-notes layer's data (null before a map) and arming, mirrored like the fields above. */
  annotations: AnnotationsState | null;
  annotationTool: AnnotationTool;
  annotationZoneShape: AnnotationZoneShape;
  annotationColor: string;
  annotationTag: TagId;
  annotationSize: 's' | 'm' | 'l';
  annotationRouteDashed: boolean;
  annotationSelection: string[];
  annotationDraft: MapAnnotation | null;
  /** The annotation slice's verbs, one handle the way `macroContext` is one handle. */
  annotationEdit: AnnotationEditVerbs;
  /** The drawn label for a tag, in the interface language. Hit tests read caption widths from it. */
  tagLabel: (tag: TagId) => string;
}

export interface AnnotationEditVerbs {
  /** One lane entry for the gesture about to apply, however many `apply` calls follow. */
  begin(): void;
  apply(fn: (data: AnnotationsState) => void): void;
  add(a: MapAnnotation): void;
  remove(id: string): void;
  select(ids: string[]): void;
  setDraft(a: MapAnnotation | null): void;
  /** Turn the standing draft into a note; false when nothing commits. */
  commitDraft(): boolean;
}

export interface Tool {
  id: ToolType;
  /** Whether pointer cells follow the half-cell terrain offset instead of the object grid. */
  terrainGrid?(ctx: ToolContext): boolean;
  /** WHICH cursor, not a CSS value: the canvas layer owns the CSS (ui/design/cursors). */
  cursor: CursorId;
  /**
   * The cursor a tool can only name with the CONTEXT in hand — the placer's `place` vs `select`,
   * which is a question about what is armed. `cursor` above stays the answer for a tool whose
   * cursor is a property of the tool itself (the brush's surface, the eraser's), and is this one's
   * fallback. Read through `ToolManager.getActiveCursor()`, which refreshes the context first.
   */
  cursorFor?(ctx: ToolContext): CursorId;
  /**
   * False when acting on this cell would be refused, so the cursor can say so BEFORE the
   * click instead of the error flash saying it after. Optional: a tool that cannot answer
   * cheaply omits it and keeps its plain cursor. Must not mutate state.
   */
  canActAt?(coord: MacroCoord, ctx: ToolContext): boolean;
  /**
   * A multi-click gesture in progress (the curve's chain of anchors) that has painted nothing yet.
   * Escape abandons it and Delete takes back its last step, so those keys reach the pending gesture
   * before they reach the selection. Both return whether there WAS something pending, which is how
   * the keyboard command knows not to fall through. Tools with no such gesture omit them.
   */
  cancelPending?(ctx: ToolContext): boolean;
  undoPendingStep?(ctx: ToolContext): boolean;
  /** Whether a multi-tap gesture is standing, for a nav tap to end it (`core/interaction/
   *  press-plan.ts:resolveNavTap`) — right/middle drag is the camera, so a right press that never
   *  moved is the one press with no camera meaning left in it. Takes the context because a pending
   *  gesture can live in the STORE (the annotate tool's route draft, which the bar can clear
   *  without this tool hearing) — an answer mirrored on the instance outlives the thing it
   *  mirrors. Tools whose gesture is their own state ignore the argument; tools with no such
   *  gesture omit the hook. */
  hasPending?(ctx: ToolContext): boolean;
  /** Whether a plain press HERE picks up something the tool itself owns, so the drag that follows
   *  moves it (the annotate select state grabbing a note). The machine mirrors an object drag's
   *  cursor while such a drag lasts, and the press-plan keeps the camera off it; where the answer
   *  is no, a bare left drag falls to the camera the way an empty-handed mode pans. */
  grabAt?(coord: MacroCoord, ctx: ToolContext): boolean;
  /** Whether the tool is standing in ITS OWN select state: its presses pick, toggle and drag
   *  things the tool owns rather than painting. The press-plan gives such a state the map select
   *  mode's own modifier grammar — Ctrl toggles on press and a Ctrl drag is a band. */
  selects?(ctx: ToolContext): boolean;
  /** What the tool's select state finds under the pointer, and whether it is already a member of
   *  the tool's own selection — the facts behind the modifier cursor's add/remove badge. */
  selectHit?(coord: MacroCoord, ctx: ToolContext): { id: string; selected: boolean } | null;
  onPointerDown(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
  onPointerMove(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
  onPointerUp(coord: MacroCoord, micro: MicroCoord, ctx: ToolContext): void;
  /** Stop asynchronous stroke work when the browser cancels input or touch becomes navigation. */
  onPointerCancel?(ctx: ToolContext): void;
  onActivate(ctx: ToolContext): void;
  onDeactivate(ctx: ToolContext): void;
}
