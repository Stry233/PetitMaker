import { useEffect, type RefObject } from 'react';
import { paintRegionCell, finishRegionStroke } from '../../core/runtime/region-brush';
import { useEditorStore } from '../../state/store';
import { getActiveToolManager, getActiveView } from '../active-view';
import type { ToolOverlay, ViewProjection } from '../view-projection';
import { ToolType, CommandType } from '../../core/model/types';
import type { MacroCoord, GridState, PlacedObject } from '../../core/model/types';
import type { BlockRef } from '../../state/store';
import { selectedObjectIds } from '../../state/selection';
import { getCell, getFootprint } from '../../core/model/grid-model';
import {
  groupMembers, moveGroup, planObjectMove, previewGroupMove, stripCoatingsFor,
  GHOST_INVALID, GHOST_VALID,
} from '../../tools/objects';
import { getPlacedObjectSize, hasHalfStep, resolveAnchor, snapsOwnPlacement } from '../../state/object-geometry';
import { getCatalogItem } from '../../state/catalog';
import { arcMotion, arcOffset, type GroupRotation } from '../group-arc';
import { isDraggableObject, objectUnderPointer, selectionHoverBox } from './selection-hover';
import { isBrushTool } from '../../core/interaction/tool-modes';
import {
  cursorFactsFor, resolveNavTap, resolvePress, type PressFacts, type PressIntent, type PressPlan,
} from '../../core/interaction/press-plan';
import { isNavButton, PRIMARY_BUTTON } from '../../core/interaction/pointer-buttons';
import { TouchPinch } from './gestures';
import { createCameraGestures, DRAG_THRESHOLD } from './camera-gestures';
import { noteNavGestureLost } from './nav-gesture-hint';
import { macroRect, objectsInBand } from './marquee';
import { installModifierTracking, isPanDragHeld, isMultiSelectHeld, onMultiSelectChange } from '../../core/runtime/modifier-state';
import { anyOverlayOpen } from '../../core/runtime/overlay-state';
import {
  setCursorDrag, setCursorForbidden, setCursorOverSelected, setCursorCtrlHint, setCursorPressSelects,
} from './cursor-controller';

/**
 * Draw (or clear) the selection outline for the whole selection, resolving each
 * member's geometry from the grid. A single member draws a ring plus an optional
 * elevation label and an entrance pop (`append=false`). A GROUP clears once then
 * draws one ring per member with `append=true`: no per-member clear, no label (one
 * label can't speak for N members at possibly different elevations), no pop (it
 * would replay N times). Terrain is never multi-selected, so `refs.length > 1` is
 * all objects by construction.
 *
 * Callers: the pointer machine, plus the PixiCanvas/Editor3DCanvas sync effects
 * (layer-visibility / objects-changed) that re-paint the selection.
 */
export function paintSelection(
  overlay: ToolOverlay,
  gs: GridState,
  refs: readonly BlockRef[],
  showNumbers: boolean,
): void {
  if (refs.length === 0) { overlay.clearSelection(); return; }
  if (refs.length === 1) { paintOneBlock(overlay, gs, refs[0]!, showNumbers, false); return; }
  overlay.clearSelection();
  for (const block of refs) paintOneBlock(overlay, gs, block, showNumbers, true);
}

function paintOneBlock(
  overlay: ToolOverlay,
  gs: GridState,
  block: BlockRef,
  showNumbers: boolean,
  append: boolean,
): void {
  if (block.kind === 'object') {
    const obj = gs.objects.get(block.id);
    if (!obj) { if (!append) overlay.clearSelection(); return; }
    // A view that can bound the rendered body draws the 3D box; the footprint
    // ring is the universal fallback (and the 2D behavior).
    if (overlay.showObjectSelection) {
      overlay.showObjectSelection(obj.id, append);
      return;
    }
    const size = getPlacedObjectSize(obj);
    overlay.showSelection(
      obj.position.x, obj.position.y, size.w, size.h,
      append || showNumbers ? undefined : obj.elevation, false, append,
    );
  } else {
    const cell = getCell(gs.cells, block.x, block.y);
    overlay.showSelection(
      block.x, block.y, 1, 1,
      append || showNumbers ? undefined : (cell?.terrain?.elevation ?? 0), true, append,
    );
  }
}

/**
 * Repaint the selection ring at `eased` through a rotation's sweep — the SAME progress
 * `animateRotation`/`animateGroupRotation` just applied to the icon/instances, so the ring rides one
 * clock instead of computing its own interpolation of the same turn (see `canvas/group-arc.ts`'s file
 * header for why a second interpolation of one motion is exactly the bug class this exists to avoid).
 *
 * `members` carries each ring's live CENTRE offset in cell units (zero for a single spin, which never
 * moves; the group arc's own `arcOffset` for a group turn). The ring's SHAPE always uses the CURRENT
 * (already-committed, post-turn) footprint size: the command applies instantly, so the object's own
 * rendered box is already at that shape by the time any tween frame runs (`objects-changed` rebuilds
 * it synchronously, before the animation is even started) — drawing a ring at any other shape would
 * disagree with what is already on screen. Only the CENTRE travels.
 *
 * At `eased >= 1` this instead repaints through the normal `paintSelection` path: a view with a
 * body-bound box (3D's `showObjectSelection`) gets that back, rather than staying on the plain
 * footprint ring the arc frames use, and a view without one lands on the identical rect either way.
 */
function paintRotationRing(
  overlay: ToolOverlay, gs: GridState, members: ReadonlyArray<{ id: string; dx: number; dy: number }>,
  eased: number, showNumbers: boolean,
): void {
  if (eased >= 1) {
    paintSelection(overlay, gs, members.map((m) => ({ kind: 'object', id: m.id }) as const), showNumbers);
    return;
  }
  const append = members.length > 1;
  overlay.clearSelection();
  for (const m of members) {
    const obj = gs.objects.get(m.id);
    if (!obj) continue; // a member can vanish mid-flight (undo, delete) — skip, don't abandon the rest
    const size = getPlacedObjectSize(obj);
    overlay.showSelection(
      obj.position.x + m.dx, obj.position.y + m.dy, size.w, size.h,
      append || showNumbers ? undefined : obj.elevation, false, append,
    );
  }
}

/** `animateRotation`'s onFrame hook: a lone spin never moves or reshapes (see `paintRotationRing`),
 *  so this just keeps the ring painted through the same clock as the icon for API symmetry with the
 *  group hook below — there is nothing for a square item's ring to visibly do, and a non-square
 *  item's ring already holds its final (correct) shape throughout rather than tracking the icon's
 *  own still-turning visual angle. */
export function paintSpinRing(
  overlay: ToolOverlay, gs: GridState, id: string, eased: number, showNumbers: boolean,
): void {
  paintRotationRing(overlay, gs, [{ id, dx: 0, dy: 0 }], eased, showNumbers);
}

/** `animateGroupRotation`'s onFrame hook: every member's ring travels the SAME arc its wrapper does
 *  (see `paintRotationRing`), landing back on the plain selection exactly when the sprites do. */
export function paintGroupRotationArc(
  overlay: ToolOverlay, gs: GridState, turn: GroupRotation, eased: number, showNumbers: boolean,
): void {
  const sweepRad = (turn.sweepDeg * Math.PI) / 180;
  const members = turn.members.map((m) => {
    const { dx, dy } = arcOffset(arcMotion(turn.pivot, m.from), sweepRad, eased);
    return { id: m.id, dx, dy };
  });
  paintRotationRing(overlay, gs, members, eased, showNumbers);
}

/**
 * Everything the hover preview and the cursor depend on BESIDES where the pointer is.
 *
 * ONE definition, read by the subscription that asks for a re-sample AND by the gate that decides
 * whether to recompute. Those two have to agree: a trigger the gate does not know about re-samples
 * and is thrown away, and a gate input nothing triggers waits for the user to jiggle the mouse.
 * Keeping them on one list is what stops the next dependency needing its own bespoke wiring.
 *
 * `mapEpoch` stands in for the map itself. The grid mutates IN PLACE, so no store subscription can
 * see a placement or a paint; the map-mutation events bump a counter instead.
 *
 * `toolEpoch` stands in for the tool layer, which mutates in place for the same reason and LAGS the
 * store besides: the canvas writes the ToolManager's tool and the DrawingTool's shape and surface in
 * an effect, which runs after the store has already told its subscribers. A probe run on the store
 * change alone therefore asks the tool the user has just left, and caches that answer under the new
 * inputs, so the badge keeps the departed tool's verdict until the pointer crosses into another cell.
 * The `tool-synced` bump is what asks again once the tool being asked is the one the store names, and
 * it is the only input covering a change of SURFACE or SHAPE, which move no store field named here.
 *
 * `autoEdgeCut` and `tileMaterial` are here because the GHOST is drawn from them: the trim decides
 * the shape the preview promises and the material decides its colour, so a build-bar setting
 * changed while the pointer stands over the map otherwise leaves a preview of the stroke the user
 * has just stopped asking for, until they jiggle the mouse.
 *
 * A LIST OF VALUES, compared member by member — never serialized. `selection` carries one entry per
 * selected object, so joining it into a string cost 0.2 ms and 48 KB of garbage per call at a
 * select-all on a generated map, on a list read at pointer-move rate by both mounted canvases. The
 * store REPLACES the selection array on every change (`state/slices/engine.ts`) and never mutates it
 * in place, so its identity already answers the only question this list asks of it.
 */
type HoverInputs = readonly unknown[];

function hoverInputs(
  s: ReturnType<typeof useEditorStore.getState>, mapEpoch: number, toolEpoch: number, multiSelectHeld: boolean,
): HoverInputs {
  return [
    s.activeTool, s.selectedItemId, s.armedMacro, s.brushSize, s.selectingRegion, s.placementRotation, s.viewMode,
    s.autoEdgeCut, s.tileMaterial, s.selection,
    mapEpoch, toolEpoch, multiSelectHeld,
  ];
}

function sameHoverInputs(a: HoverInputs | null, b: HoverInputs): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The ids a drag anchored on `anchorId` carries, or null when it carries that object alone:
 *  the whole selection, when it is plural and the anchor belongs to it. */
function groupDragIds(sel: readonly BlockRef[], anchorId: string): string[] | null {
  if (sel.length < 2) return null;
  const ids = selectedObjectIds(sel);
  return ids.length > 1 && ids.includes(anchorId) ? ids : null;
}

/**
 * `obj`'s anchor at screen point (sx, sy) plus `offset` — the ONE seam the press (offset {0,0},
 * to capture the grab), the live drag ghost and the drop all resolve through
 * (`state/object-geometry:resolveAnchor`), so none of the three can land on a different cell for
 * the same pointer read. Reads the pointer at `obj`'s OWN item's granularity: `screenToHalf` for
 * a halfStep ramp/bridge, `screenToMacro` otherwise — `screenToHalf` is asked for ONLY when the
 * item wants it (skips a pointless projection call for the common case, and `resolveAnchor`
 * would ignore it anyway). Falls back to the plain whole-cell reading when `obj`'s catalog item
 * is unknown (a corrupt catalogId).
 *
 * NOT used for a GROUP move (see the comment beside `moveGroup`'s call below): a mixed
 * selection's delta stays a whole-cell integer deliberately.
 */
function objectPointerAnchor(
  obj: PlacedObject, projection: ViewProjection, sx: number, sy: number, offset: MacroCoord,
): MacroCoord {
  const whole = projection.screenToMacro(sx, sy);
  const item = getCatalogItem(obj.catalogId);
  if (!item) return { x: Math.round(whole.x + offset.x), y: Math.round(whole.y + offset.y) };
  const half = hasHalfStep(item) ? projection.screenToHalf?.(sx, sy) : undefined;
  return resolveAnchor(item, whole, half, offset);
}

/** Enough of a pointer position to resolve a hover/target check. Real PointerEvents satisfy this
 *  structurally; `usePointerInteraction`'s resampler constructs one from the last known screen
 *  position for a pointer that never moved but whose CELL (or ghost orientation) did — the camera
 *  panned under it, or the armed item's rotation flipped — since there is no real event to read at
 *  that moment. */
type PointerSample = { clientX: number; clientY: number; pointerType: string; target: EventTarget | null };

/**
 * The pointer-gesture state machine: right/middle-drag navigate, wheel input by INTENT (mouse notch =
 * stepped zoom, touchpad two-finger scroll = pan, pinch/ctrl+wheel = smooth anchored zoom —
 * see WheelClassifier), left-click block select, drag-to-move with a validity-tinted ghost +
 * atomic remove/place commit, region brush, right/middle-tap context menu, and TOUCH: one finger
 * drives the active tool, a second finger switches to pinch-zoom + pan (cancelling anything
 * the first finger started — see cancelTouchStroke).
 */
export function usePointerInteraction(
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const view = getActiveView;
  const tools = getActiveToolManager;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The camera half of this machine lives in `camera-gestures`, shared with the export shot
    // editor. What stays here is WHEN a left drag pans, which depends on the tool and the
    // selection, and which the flags below gate the rest of the machine on.
    const gestures = createCameraGestures({
      camera: () => view()?.camera ?? null,
      onDragChange: setCursorDrag,
      onGestureLost: noteNavGestureLost,
    });
    let leftPanning = false;
    let toolDown = false;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragObjId: string | null = null;
    // Where the object's top-left sits relative to the grabbed cell, so the
    // object follows the cursor from where it was picked up (not snapped by its
    // top-left corner).
    let grabOffsetX = 0;
    let grabOffsetY = 0;
    /**
     * The pointer offset the SOLO drag resolves its anchor with. A snapping item (bridge/ramp) has
     * no grab to preserve: the trait DETECTS a gap/cliff near the position it is handed, so what
     * the pointer names is a probe anchor and what the object carries is the snapped footprint's
     * top-left (`snapsOwnPlacement`). Tracking the top-left rigidly therefore hands the judge a cell
     * a whole span away from the ghost being aimed: the ghost sits on the cliff and is refused until
     * the cursor has travelled another span past it. Zeroed, the pointer names the cliff directly,
     * exactly as a fresh placement's does, and the snap RANGE around it decides.
     *
     * The GROUP branch keeps the real offset: its delta arithmetic (`macro + grabOffset −
     * obj.position`) is a pure pointer delta only because the two obj.position terms cancel.
     */
    const soloDragOffset = (obj: PlacedObject): MacroCoord =>
      snapsOwnPlacement(getCatalogItem(obj.catalogId))
        ? { x: 0, y: 0 }
        : { x: grabOffsetX, y: grabOffsetY };
    // The (groupIds, dx, dy) key the drag ghost last recomputed for — a pointer move that lands on
    // the SAME macro cell as the previous one (the common case: native pointer events fire far more
    // often than the grabbed cell changes) changes nothing about the ghost, so this skips re-running
    // the group's O(members) validity re-check and rebuilding the ghost geometry. Reset per drag.
    let lastDragGhostKey: string | null = null;
    // True when this pointer-down landed on the already-selected block; a tap
    // (no drag) then deselects it on pointer-up.
    let toggleOffOnUp = false;
    // Set when the press landed on a member of a PLURAL selection: an unmodified click selects
    // that object alone, while a drag moves the whole group.
    let collapseToOnUp: string | null = null;
    // A Ctrl-held press arms a potential rubber band regardless of what's under it (an object
    // still toggles on press, but Ctrl NEVER arms a move); bandActive flips on once the drag
    // clears DRAG_THRESHOLD. Releasing Ctrl mid-drag does not cancel it: nothing re-reads
    // isMultiSelectHeld() once armed.
    let bandArmed = false;
    let bandActive = false;
    let bandStartMacro: MacroCoord | null = null;
    let bandStartX = 0;
    let bandStartY = 0;
    // The macro cell the idle-hover probe last ran the cursor rules against: a pointer-move that
    // stays on the same cell does not re-run them.
    let hoverCell: MacroCoord | null = null;
    /** The `hoverInputs` signature the current hover answer was computed from. */
    let hoverInputsKey: HoverInputs | null = null;
    /** Bumped on every map mutation — see `hoverInputs`. */
    let mapEpoch = 0;
    /** Bumped every time the canvas finishes writing the tool layer — see `hoverInputs`. */
    let toolEpoch = 0;
    // The pointer's last known screen position while it is meaningfully "here": over this canvas,
    // or mid-stroke on it. Set on every real (non-touch) pointer down/move that reaches this
    // container or drives an active tool stroke; forgotten on pointerleave. A stationary pointer is
    // still over a moving CELL when the camera pans by some OTHER means (WASD, or any camera verb
    // outside this pointer machine) — re-sampling this position on a viewport change is what lets a
    // live stroke keep painting, and the hover/ghost keep tracking the cell they'd actually land on.
    let lastPointerX = 0;
    let lastPointerY = 0;
    let pointerKnown = false;
    // Guards the resampler below against re-entering itself: the gesture-flag guard enumerates
    // every gesture that pans through ITS OWN live pointermove, but a synchronous camera-transform
    // emitter that pans through none of them (the 2D Hand tool drags the camera from inside
    // ToolManager, setting no flag here) would otherwise feed handlePointerMove back into the same
    // 'viewport-changed' emission it just caused, recursing until the call stack overflows.
    let resampling = false;
    // Touch: active points + pinch math live in TouchPinch; `touchNavigating` flips on when a
    // second finger lands and stays on until every finger lifts (fingers navigate, they never
    // draw mid-gesture). `touchUndoStart` is the undo-stack watermark taken when a single touch
    // starts a tool stroke, so a pinch can cancel whatever that finger already painted.
    const touchPinch = new TouchPinch();
    let touchNavigating = false;
    let touchUndoStart = -1;

    /** A second finger landed (or the touch was cancelled) while a touch stroke was live:
     *  close the stroke, then undo whatever it committed — the finger meant to navigate. */
    const cancelTouchStroke = (x: number, y: number) => {
      if (!toolDown) return;
      toolDown = false;
      tools()?.handlePointerUp(x, y);
      const executor = useEditorStore.getState().commandExecutor;
      if (executor && touchUndoStart >= 0) {
        while (executor.getUndoStackSize() > touchUndoStart) executor.undo();
      }
      touchUndoStart = -1;
      view()?.overlay.clearGhost();
    };

    /**
     * A Ctrl gesture ended with something selected while an item was armed: the placement session
     * is over, so the item is dropped and the pointer lands in the ordinary select/drag mode.
     *
     * An EMPTY result keeps the item armed — a band that caught nothing, or a toggle that emptied
     * the selection, leaves nothing to edit, so an accidental Ctrl-drag over bare ground must not
     * cost the user the item they picked in the panel.
     *
     * A brush/eraser/edge-cut gesture already left terrain-editing mode BEFORE this runs (see
     * `leaveBrushForSelection`, called right before the selection write itself) — nothing left to
     * do for it here, so only the armed-placer branch fires.
     */
    const disarmAfterCtrlSelect = () => {
      const store = useEditorStore.getState();
      if (store.activeTool !== ToolType.ObjectPlacer || !store.selectedItemId) return;
      if (store.selection.length === 0) return;
      store.setEditMode({ itemId: null });
      view()?.overlay.clearGhost();
      // The positional cursor facts were resolved for the armed mode, and no pointer event follows
      // a key-driven mode change: drop them so the next move re-probes this cell.
      hoverCell = null;
      setCursorPressSelects(false);
    };

    /**
     * A build brush (terrain/eraser/edge-cut) gesture is about to WRITE a selection — a Ctrl+click
     * adding the first member, or a band about to add its catches: switch to the Hand tool NOW,
     * BEFORE that write, not after.
     *
     * Order matters: PixiCanvas's store subscription clears any selection the CURRENT tool cannot
     * hold (`canHoldSelection`), which none of these brush tools can. Writing the selection first
     * and switching tools after would have that subscription fire on the write itself — while the
     * tool is still a brush — and erase the very selection this gesture just made, before the
     * switch ever lands. A brush tool has no armed "item" to drop (unlike the placer), so the tool
     * itself is what changes to land the pointer in select/drag mode, mirroring `inSelectMode`.
     *
     * Selection is always empty on entry here (switching TO a brush tool already dropped whatever
     * was selected, by that same subscription), so this only ever needs to fire once per gesture.
     */
    const leaveBrushForSelection = () => {
      const store = useEditorStore.getState();
      if (!isBrushTool(store.activeTool)) return;
      // `tool: 'none'` keeps `editMode.mode` (the build surface) so the Build panel still shows
      // the right surface, and a build tile tapped afterward resumes on it; the resolver reads it
      // as 'hand' design mode, not the brush that just left, so the panel highlights no tile.
      store.setEditMode({ tool: 'none' });
    };

    const el = container;
    // Takes any event-like value with a `target` (a real DOM Event, or a PointerSample built for the
    // resampler below) — both need the same "is this actually over MY canvas" test.
    function isCanvasTarget(e: { target: EventTarget | null }): boolean {
      const target = e.target;
      if (!(target instanceof Node)) return false; // window/document targets are never the canvas
      return el.contains(target);
    }

    // Wheel input over the canvas, routed by INTENT: a mouse notch keeps the classic stepped
    // zoom; a touchpad two-finger scroll PANS (see gestures.ts for the rationale). Ctrl+scroll
    // (incl. the synthesized ctrl+wheel of a trackpad pinch) is handled globally below so it
    // zooms even when the cursor is over a panel.
    const onWheel = (e: WheelEvent) => {
      if (!isCanvasTarget(e) || e.ctrlKey) return;
      e.preventDefault();
      gestures.wheel(e);
    };
    // Ctrl + scroll (or trackpad pinch) ALWAYS zooms the map, anywhere on screen — smooth and
    // proportional to the gesture, unlike the mouse notch's fixed steps.
    const onWheelGlobal = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // While a modal is up, ctrl+scroll must not reach the map behind it — the user is
      // interacting with the dialog, not the canvas. Still preventDefault so the browser's
      // page zoom doesn't fire either; just don't zoom the (background) map.
      if (anyOverlayOpen()) { e.preventDefault(); return; }
      e.preventDefault(); // also stops the browser's page zoom
      gestures.pinchWheel(e);
    };

    let regionBrushing = false;
    let panKeyPanning = false;

    /** A touch press: a second finger turns the gesture into camera navigation and cancels
     *  whatever the first finger started; a single finger falls through to the tool/select path
     *  with an undo watermark, so a later pinch can take back anything it painted. */
    const touchDown = (e: PointerEvent): boolean => {
      if (e.pointerType === 'touch') {
        const count = touchPinch.down(e.pointerId, e.clientX, e.clientY);
        if (count === 2) {
          // Second finger = navigation, never drawing: cancel whatever the first finger
          // started (stroke, drag, region brush) and hand the gesture to pinch/pan.
          e.preventDefault();
          cancelTouchStroke(e.clientX, e.clientY);
          dragObjId = null;
          dragging = false;
          setCursorDrag('none');
          toggleOffOnUp = false;
          collapseToOnUp = null;
          view()?.overlay.clearGhost();
          if (regionBrushing) { regionBrushing = false; finishRegionStroke(); }
          touchNavigating = true;
          return true;
        }
        if (count > 2) { e.preventDefault(); return true; } // extra fingers join the navigation gesture
        if (touchNavigating) { e.preventDefault(); return true; } // still mid-gesture
        // Single finger falls through to the normal (tool/select) path; take the undo watermark
        // so a pinch can cleanly cancel anything this finger paints.
        touchUndoStart = useEditorStore.getState().commandExecutor?.getUndoStackSize() ?? -1;
      }

      return false;
    };

    /** Right or middle press: arm camera navigation. A tap opens the context menu on release. */
    const orbitDown = (e: PointerEvent): boolean => gestures.navDown(e);

    /**
     * Everything `resolvePress` needs, gathered from the store, the view and the active tool. The
     * press path and the nav tap build it the same way, which is what keeps them one rule.
     *
     * Null without a live view or a loaded map: there is no cell under the pointer to resolve a
     * press against, and nothing on screen for one to act on.
     */
    const buildPressFacts = (button: number, x: number, y: number): PressFacts | null => {
      const activeView = view();
      const store = useEditorStore.getState();
      const gs = store.gridState;
      if (!activeView || !gs) return null;
      const macro = activeView.projection.screenToMacro(x, y);
      // Mesh-precise pick first (a tree's canopy selects the tree), then the footprint test, which
      // covers flat items and views without mesh picking.
      const hit = objectUnderPointer(gs, macro, activeView.projection.pickObject?.(x, y) ?? undefined);
      const tool = tools()?.getActiveTool();
      const ctx = tools()?.getContext();
      return {
        button,
        tool: store.activeTool,
        armedItemId: store.selectedItemId,
        selection: store.selection,
        selectingRegion: store.selectingRegion,
        panDragHeld: isPanDragHeld(),
        multiSelectHeld: isMultiSelectHeld(),
        macro,
        hit: hit ? { id: hit.id, draggable: isDraggableObject(hit), locked: !!hit.locked } : null,
        placementAllowed: !tool?.canActAt || !ctx || tool.canActAt(macro, ctx),
        pendingGesture: tool?.hasPending?.() ?? false,
        viewPansLeftDrag: activeView.leftDragPans !== false,
      };
    };

    /** Perform one intent: every mechanism the machine has, addressed by name. */
    const runIntent = (intent: PressIntent, e: PointerEvent, f: PressFacts): void => {
      const store = useEditorStore.getState();
      switch (intent.kind) {
        case 'pan-camera':
          // `by: 'tool'` means the view's own tool path moves the camera (2D, through HandTool), so
          // the machine reports the drag and pans nothing. HandTool tracks no grip of its own, so
          // without that report nothing ever closes the hand.
          if (intent.by === 'tool') { setCursorDrag('pan'); return; }
          if (intent.source === 'pan-key') panKeyPanning = true;
          else leftPanning = true;
          gestures.panFrom(e.clientX, e.clientY);
          return;
        case 'paint-region':
          paintRegionCell(f.macro);
          regionBrushing = true;
          return;
        case 'tool-stroke':
          toolDown = true;
          tools()?.handlePointerDown(e.clientX, e.clientY);
          return;
        case 'select':
          store.setSelection([intent.block]);
          return;
        case 'toggle-select':
          store.toggleSelection(intent.block);
          return;
        case 'deselect':
          toggleOffOnUp = true;
          return;
        case 'collapse-select':
          collapseToOnUp = intent.id;
          return;
        case 'move-selection': {
          const obj = store.gridState?.objects.get(intent.anchorId);
          if (!obj) return;
          dragObjId = intent.anchorId;
          // Reported like a pan or an orbit is: the drag is a first-class cursor state, so the
          // press has feedback whichever tool armed it.
          setCursorDrag('object');
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          // The grab offset, at the SAME granularity the live drag and the drop will read the
          // pointer at (objectPointerAnchor, offset {0,0}: nothing is grabbed yet) — half-cell
          // for a halfStep ramp/bridge, so a grab anywhere on its half-covered footprint drags
          // true, whole otherwise.
          const pressProjection = view()?.projection;
          const pressAnchor = pressProjection
            ? objectPointerAnchor(obj, pressProjection, e.clientX, e.clientY, { x: 0, y: 0 })
            : f.macro;
          grabOffsetX = obj.position.x - pressAnchor.x;
          grabOffsetY = obj.position.y - pressAnchor.y;
          lastDragGhostKey = null;
          return;
        }
        case 'band-select':
          bandArmed = true;
          bandStartMacro = intent.from;
          bandStartX = e.clientX;
          bandStartY = e.clientY;
          // Neither the armed item's placement preview nor a brush's paint preview has anything
          // left to show: this gesture selects.
          view()?.overlay.clearGhost();
          return;
        case 'context-menu':
          store.setContextMenu({ x: e.clientX, y: e.clientY, target: intent.block });
          return;
        case 'cancel-pending': {
          const mgr = tools();
          const t = mgr?.getActiveTool();
          const c = mgr?.getContext();
          if (t && c) t.cancelPending?.(c);
          return;
        }
      }
    };

    /**
     * Apply a resolved plan.
     *
     * The ORDER is the machine's, not the plan's: the selection write, then the flags a tap or a
     * drag will read, then the tool stroke. `handlePointerDown` executes commands, so the stroke
     * runs last, with everything else this press sets already in place. A plan never carries a
     * stroke alongside a move or a band (arming either is what withholds the press from the tool),
     * so the only pair this reorders is the stroke against the pan the same press arms.
     */
    const runPlan = (p: PressPlan, e: PointerEvent, f: PressFacts): void => {
      for (const i of p.down) if (i.kind !== 'tool-stroke') runIntent(i, e, f);
      for (const i of p.onTap) runIntent(i, e, f);
      for (const i of p.onDrag) runIntent(i, e, f);
      for (const i of p.down) if (i.kind === 'tool-stroke') runIntent(i, e, f);
    };

    /** A left press: pan with the pan-drag key, paint a region, resolve the selection, or start a
     *  tool stroke — whichever `resolvePress` says this one means. */
    const leftDown = (e: PointerEvent): void => {
      if (e.button !== PRIMARY_BUTTON) return;
      e.preventDefault();
      const f = buildPressFacts(PRIMARY_BUTTON, e.clientX, e.clientY);
      if (!f) return;
      const plan = resolvePress(f);
      // Navigate-while-drawing: the pan-drag key is the camera, not an edit, so it leaves the hover
      // preview and any open popover exactly as it found them.
      const panKey = plan.down.find((i) => i.kind === 'pan-camera' && i.source === 'pan-key');
      if (panKey) { runIntent(panKey, e, f); return; }
      // The press resolves the hover preview: either into a real selection (which paints the
      // orange ring) or into a tool stroke.
      view()?.overlay.clearHover();
      // The region brush owns the pointer outright, down to leaving an open context menu alone.
      const paint = plan.down.find((i) => i.kind === 'paint-region');
      if (paint) { runIntent(paint, e, f); return; }
      const store = useEditorStore.getState();
      store.setContextMenu(null);
      store.setDeletePopover(null);
      toggleOffOnUp = false;
      collapseToOnUp = null;
      // Strictly before the selection write the plan is about to make (see leaveBrushForSelection).
      if (plan.leaveBrush) leaveBrushForSelection();
      runPlan(plan, e, f);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!isCanvasTarget(e)) return;

      // Touch has no meaningful "position" once the finger lifts, so it never feeds the resampler.
      if (e.pointerType !== 'touch') { lastPointerX = e.clientX; lastPointerY = e.clientY; pointerKnown = true; }

      if (touchDown(e)) return;
      if (orbitDown(e)) return;
      leftDown(e);
    };

    /** Pan-drag key held, or nav-mode left drag: slide the camera and consume the move. */
    const panMove = (e: PointerEvent): boolean => {
      if (panKeyPanning) { gestures.panStep(e); return true; }
      // A left pan needs the button still down and a real pointer: a release outside the window
      // leaves the flag set, and touch pans through the pinch tracker instead.
      if (leftPanning && (e.buttons & 1) !== 0 && e.pointerType !== 'touch') {
        gestures.panStep(e);
        return true;
      }
      return false;
    };

    /** Touch: keep the pinch baseline fresh, and drive camera zoom/pan/twist while navigating. */
    const touchMove = (e: PointerEvent): boolean => {
      if (e.pointerType === 'touch') {
        // Keep the tracker current on every touch move (so the pinch baseline is fresh the
        // instant a second finger lands); its deltas drive the camera only while navigating.
        const delta = touchPinch.move(e.pointerId, e.clientX, e.clientY);
        if (touchNavigating) {
          if (delta) gestures.touch(delta);
          return true;
        }
        // One-finger drag in a nav-mode 3D view PANS the camera — the touch analog of the desktop
        // left-drag pan (2D already one-finger-pans via the Hand tool). leftPanning is set on
        // pointer-down only in Hand/idle mode on a view that doesn't pan left-drag itself (the 3D
        // editor). A second finger switches to the pinch/pan/twist gesture above.
        if (leftPanning && delta) {
          gestures.touch({ ...delta, scale: 1, twist: 0 }); // one finger slides, it does not zoom or twist
          return true;
        }
      }
      return false;
    };

    /** Right or middle drag: orbit the camera where the view has one, otherwise pan. */
    const orbitMove = (e: PointerEvent): boolean => gestures.navMove(e);

    /** Ctrl rubber band: grow the drawn rect. Membership is resolved once, on release. */
    const bandMove = (e: PointerEvent): boolean => {
      // Rubber band: swallow the move unconditionally once Ctrl armed it (a
      // band-armed press must never fall through to pan or a tool stroke below).
      // Only the drawn rect updates per move — objectsInBand runs once, on release.
      if (bandArmed) {
        if (!bandActive
          && (Math.abs(e.clientX - bandStartX) > DRAG_THRESHOLD || Math.abs(e.clientY - bandStartY) > DRAG_THRESHOLD)) {
          bandActive = true;
        }
        const bandView = view();
        if (bandActive && bandView && bandStartMacro) {
          bandView.overlay.showBand(macroRect(bandStartMacro, bandView.projection.screenToMacro(e.clientX, e.clientY)));
        }
        return true;
      }
      // Region brushing drag
      return false;
    };

    /** Region brush: feed the painted cell to the Generate panel. */
    const regionMove = (e: PointerEvent): boolean => {
      if (regionBrushing) {
        const macro = view()?.projection.screenToMacro(e.clientX, e.clientY);
        if (macro) paintRegionCell(macro);
        return true;
      }
      return false;
    };

    /** Drag-to-move: arm past the threshold, then draw the drop ghost for the object or the group. */
    const dragMove = (e: PointerEvent): boolean => {
      // Drag-to-move
      if (dragObjId && !dragging) {
        const ddx = e.clientX - dragStartX;
        const ddy = e.clientY - dragStartY;
        if (Math.abs(ddx) > DRAG_THRESHOLD || Math.abs(ddy) > DRAG_THRESHOLD) {
          dragging = true;
        }
      }
      const dragView = view();
      if (dragging && dragView) {
        const gs = useEditorStore.getState().gridState;
        const executor = useEditorStore.getState().commandExecutor;
        const obj = gs?.objects.get(dragObjId!);
        if (obj && executor && gs) {
          const groupIds = groupDragIds(useEditorStore.getState().selection, dragObjId!);
          if (groupIds) {
            // GROUP DRAG STAYS WHOLE-DELTA, DELIBERATELY: a mixed selection stepping by halves
            // would push every non-halfStep member off its own grid, and V-PLACE-TRAIT's
            // off-grid guard would then refuse the WHOLE move every time (all-or-nothing) — so a
            // group can never actually move. A whole-cell delta leaves each member's own half-ness
            // untouched.
            const macro = dragView.projection.screenToMacro(e.clientX, e.clientY);
            const baseX = macro.x + grabOffsetX;
            const baseY = macro.y + grabOffsetY;
            const dx = baseX - obj.position.x;
            const dy = baseY - obj.position.y;
            // Skip the whole rebuild when the GRABBED CELL hasn't moved: raw pointermove fires
            // far more often than the macro cell changes, and re-validating a group re-checks
            // every member (previewGroupMove lifts + re-places all of them) — a per-pixel re-run
            // would multiply that cost for nothing. Throttled on the cell, not a timer.
            const ghostKey = `${groupIds.join(',')}|${dx}|${dy}`;
            if (ghostKey === lastDragGhostKey) return true;
            lastDragGhostKey = ghostKey;

            // A group is judged AS a group: every member's destination, with the whole group
            // lifted (so a row sliding along itself is not a collision), and ONE tint for all of
            // them — the move is all-or-nothing, so a per-member tint would promise a partial
            // move that can never happen.
            const members = groupMembers(gs, groupIds);
            const valid = previewGroupMove(executor, gs, groupIds, dx, dy);
            const cells: MacroCoord[] = members.flatMap((m) => {
              const size = getPlacedObjectSize(m);
              return getFootprint(m.position.x + dx, m.position.y + dy, size.w, size.h);
            });
            dragView.overlay.showGhost(cells, valid ? GHOST_VALID : GHOST_INVALID, false);
            // Every member's own body rides its own drop cell, each surface-elevated under the
            // cursor's move (a terrace crossing changes each member's own drop elevation too).
            // Read through the member's OWN plan (same seam as the solo drag below), not a direct
            // cell lookup: a halfStep member keeps its half coordinate under a whole-cell group
            // slide, and a plain array has no property at that fractional key.
            dragView.overlay.showGroupPlacementGhost?.(
              members.map((m) => {
                const mx = m.position.x + dx, my = m.position.y + dy;
                return {
                  catalogId: m.catalogId, x: mx, y: my, rotation: m.rotation,
                  elevation: planObjectMove(executor, gs, m, mx, my).preview.elevation,
                };
              }),
              valid,
            );
          } else {
            // The pointer read at the DRAGGED ITEM'S OWN granularity (half-cell for a halfStep
            // ramp/bridge), so the drag steps in half cells too — reading only screenToMacro here
            // (as the group branch does, deliberately) would floor away exactly the sub-cell
            // motion a halfStep item needs, leaving it pinned to whatever offset it started with.
            const anchor = objectPointerAnchor(
              obj, dragView.projection, e.clientX, e.clientY, soloDragOffset(obj),
            );
            const ghostKey = `${dragObjId}|${anchor.x}|${anchor.y}`;
            if (ghostKey === lastDragGhostKey) return true;
            lastDragGhostKey = ghostKey;

            // Tint the drag ghost by whether the drop would be accepted, matching
            // the placement ghost (the commit re-checks the same way on release) — and draw the
            // PREVIEW geometry, which for a bridge/ramp is the span the trait snapped to, not the
            // cell under the cursor.
            const plan = planObjectMove(executor, gs, obj, anchor.x, anchor.y);
            const valid = plan.errors.length === 0;
            // A refused plan never snapped, so the preview still stands at the cursor's cell.
            const at = plan.preview;
            const size = getPlacedObjectSize(at);
            const cells: MacroCoord[] = getFootprint(at.position.x, at.position.y, size.w, size.h);
            dragView.overlay.showGhost(cells, valid ? GHOST_VALID : GHOST_INVALID, false);
            // The dragged object itself rides the cursor — the 3D view stands its
            // mesh at the drop cell, the 2D view its sprite. The mesh height must
            // follow the surface UNDER the cursor (moving across a terrace changes
            // the drop elevation), not the object's origin elevation. `at.elevation` is
            // already this: `planObjectMove` snaps it via the heightDrop/waterSpan trait for a
            // snapping item, or from the destination surface otherwise (`movedObject`) — reading
            // it off the map directly (`gs.cells[at.position.y]?.[at.position.x]`) is the SAME
            // computation duplicated, and breaks the moment either coordinate is a half index (a
            // halfStep ramp/bridge), since a plain array has no property at a fractional key.
            dragView.overlay.showPlacementGhost?.(obj.catalogId, at.position.x, at.position.y, at.rotation, valid, at.elevation);
          }
        }
        return true;
      }
      return false;
    };

    const onPointerMove = (e: PointerEvent) => {
      // Track the live screen position for the resampler: "here" means either this
      // container is literally under the pointer, or a stroke already started on it (a mid-stroke
      // drag stays live even if the browser occasionally reports a target outside the element, same
      // condition the tool-feed branch below uses).
      if (e.pointerType !== 'touch' && (toolDown || isCanvasTarget(e))) {
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        pointerKnown = true;
      }
      if (panMove(e)) return;
      if (touchMove(e)) return;
      if (orbitMove(e)) return;
      if (bandMove(e)) return;
      if (regionMove(e)) return;
      if (dragMove(e)) return;
      if (!dragging && (toolDown || isCanvasTarget(e))) {
        // While a tool is down (a stroke), replay the browser's COALESCED moves — the intermediate
        // positions it captured but batched into this one event — so a fast drag samples the real
        // trajectory instead of a single far jump. (The tool also interpolates between samples, but more
        // samples means the curve isn't chorded.) Hover (no stroke) only needs the final position.
        const coalesced = toolDown ? e.getCoalescedEvents?.() : undefined;
        if (coalesced && coalesced.length > 1) {
          for (const ce of coalesced) tools()?.handlePointerMove(ce.clientX, ce.clientY);
        } else {
          tools()?.handlePointerMove(e.clientX, e.clientY);
        }
      }
      // Idle mouse hover: preview what a click would select as a grey box.
      if (!toolDown && !dragging) updateSelectionHover(e);
    };

    /** Show/clear the grey would-select preview for an idle mouse position, and (the same
     *  hovered cell) publish the two POSITIONAL cursor facts: whether the active tool would
     *  refuse this cell, and whether the pointer is over the already-selected object (where
     *  drag-to-move arms). Only the instance whose canvas is under the pointer may touch the
     *  hover state — both canvases run this hook, and the hidden one must not clear what the
     *  visible one draws (its own pointerleave handles departures). Takes a PointerSample rather than
     *  a PointerEvent so the resampler can call it with the last known position; a real PointerEvent
     *  satisfies PointerSample structurally. */
    const updateSelectionHover = (e: PointerSample) => {
      if (!isCanvasTarget(e)) return;
      const hoverView = view();
      if (!hoverView) return;
      if (e.pointerType === 'touch') {
        // Touch has no cursor and no Ctrl: never leave a stale probe result behind.
        hoverCell = null;
        setCursorForbidden(false);
        setCursorOverSelected(false);
        setCursorCtrlHint(null);
        setCursorPressSelects(false);
        hoverView.overlay.clearHover();
        return;
      }
      const store = useEditorStore.getState();
      const macro = hoverView.projection.screenToMacro(e.clientX, e.clientY);
      const meshHit = hoverView.projection.pickObject?.(e.clientX, e.clientY) ?? undefined;
      const box = store.gridState
        ? selectionHoverBox(
            store.gridState,
            macro,
            store.activeTool, store.selectedItemId, store.selectingRegion, store.selection,
            meshHit,
          )
        : null;
      if (box) hoverView.overlay.showHover(box.x, box.y, box.w, box.h, box.terrainMode);
      else hoverView.overlay.clearHover();

      // The rule pipeline runs when one of its INPUTS changes, not per pointer-move: the hovered
      // cell, the multi-select key, and everything `hoverInputs` names.
      const inputs = hoverInputs(store, mapEpoch, toolEpoch, isMultiSelectHeld());
      if (!hoverCell || hoverCell.x !== macro.x || hoverCell.y !== macro.y || !sameHoverInputs(hoverInputsKey, inputs)) {
        hoverCell = macro;
        hoverInputsKey = inputs;
        const f = buildPressFacts(PRIMARY_BUTTON, e.clientX, e.clientY);
        if (f) {
          const c = cursorFactsFor(f);
          // The forbidden badge answers a question about the TOOL, not about the press: whether this
          // cell would be refused. `placementAllowed` is that same probe, run once for both.
          setCursorForbidden(!f.placementAllowed);
          setCursorCtrlHint(c.ctrlHint);
          setCursorOverSelected(c.overSelected);
          setCursorPressSelects(c.pressSelects);
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        const count = touchPinch.up(e.pointerId);
        if (touchNavigating) {
          if (count === 0) touchNavigating = false;
          return; // navigation fingers never reach the tool/select paths
        }
        touchUndoStart = -1;
      }
      if (bandArmed) {
        const bandView = view();
        if (bandActive && bandView && bandStartMacro) {
          const rect = macroRect(bandStartMacro, bandView.projection.screenToMacro(e.clientX, e.clientY));
          bandView.overlay.clearBand();
          const gs = useEditorStore.getState().gridState;
          const covered = gs ? objectsInBand(gs, rect) : [];
          if (covered.length > 0 && gs) {
            const store = useEditorStore.getState();
            const existing = store.selection;
            const additions = covered
              .filter((id) => !existing.some((r) => r.kind === 'object' && r.id === id))
              .map((id) => ({ kind: 'object', id } as const));
            if (additions.length > 0) {
              // Leave a brush's terrain-editing mode BEFORE writing the selection (see
              // leaveBrushForSelection) — not after, or the tool-can't-hold-a-selection
              // subscription would clear this same write before the switch lands.
              leaveBrushForSelection();
              store.setSelection([...existing, ...additions]);
            }
          }
        }
        bandArmed = false;
        bandActive = false;
        bandStartMacro = null;
        disarmAfterCtrlSelect();
        return;
      }
      if (isNavButton(e.button)) {
        const nav = gestures.navUp();
        // A tap targets whatever is under the pointer when it LIFTS, not where it landed, so the
        // facts are gathered here rather than carried from the press.
        if (nav.navigated && !nav.moved) {
          const f = buildPressFacts(e.button, e.clientX, e.clientY);
          if (f) for (const intent of resolveNavTap(f)) runIntent(intent, e, f);
        }
        return;
      }
      if (regionBrushing) {
        regionBrushing = false;
        finishRegionStroke(); // commits the brushed region to React state
        return;
      }
      if (dragging && dragObjId) {
        dragging = false;
        const movedId = dragObjId;
        dragObjId = null;
        // This branch RETURNS before the shared button-0 cleanup below, so the drag state it
        // published has to be retired here or the cursor stays on `move` after the drop.
        setCursorDrag('none');
        const dropView = view();
        dropView?.overlay.clearGhost();

        const gs = useEditorStore.getState().gridState;
        const executor = useEditorStore.getState().commandExecutor;
        const obj = gs?.objects.get(movedId);
        if (!obj || !gs || !executor || !dropView) return;

        const groupIds = groupDragIds(useEditorStore.getState().selection, movedId);
        if (groupIds) {
          // GROUP DRAG STAYS WHOLE-DELTA — see `dragMove` for why a half-cell step refuses the
          // whole move.
          const macro = dropView.projection.screenToMacro(e.clientX, e.clientY);
          const newX = macro.x + grabOffsetX;
          const newY = macro.y + grabOffsetY;
          if (newX === obj.position.x && newY === obj.position.y) return;
          // The whole selection travels by the drag's delta, all-or-nothing. Emitting the refusal
          // is what flashes the offending cells and raises the toast. Every member lands (a move
          // never turns anything), so each gets the same squash cue a single placement plays —
          // requested per member, right as ITS OWN placement command is about to run (see
          // GroupPlaceHook: applyGroupTransform lifts the whole group before placing any of it, so
          // there is no earlier moment where the destination wrapper already exists to animate).
          const res = moveGroup(
            executor, gs, groupIds, newX - obj.position.x, newY - obj.position.y,
            (member) => dropView.plopObject?.(member.id),
          );
          if (res.refusal) {
            useEditorStore.getState().eventBus.emit('validation-failed', res.refusal);
            return;
          }
          // The members keep their ids, so the selection still names them; only the rings move.
          return;
        }

        // The SAME anchor resolution the live drag ghost used (objectPointerAnchor): the pointer
        // read at the dragged item's own granularity, so a halfStep object's drop lands on the
        // half grid it was actually dragged to, not wherever a whole-cell reading would floor it.
        const anchor = objectPointerAnchor(obj, dropView.projection, e.clientX, e.clientY, soloDragOffset(obj));

        const { cmd: placeCmd, errors, preview } = planObjectMove(executor, gs, obj, anchor.x, anchor.y);
        // Nothing moved. Judged on the SNAPPED destination, not the anchor: a snapping item's
        // anchor is never its position, so only the snap can answer whether the drop is a no-op.
        // (For everything else the preview stands at the anchor, which is the test this replaces.)
        if (preview.position.x === obj.position.x && preview.position.y === obj.position.y
            && preview.rotation === obj.rotation) return;
        if (errors.length > 0) {
          // Invalid drop — emit so the renderer flashes the bad cells AND the
          // global toast surfaces the reason; the object stays put.
          useEditorStore.getState().eventBus.emit('validation-failed', { cmd: placeCmd, errors });
          return;
        }

        const strokeStart = executor.getUndoStackSize();
        executor.execute({
          type: CommandType.RemoveObject,
          timestamp: Date.now(),
          objectId: obj.id, removedObject: obj,
        });
        // Coat over any road the drop lands on, exactly as placing the item fresh would. Inside
        // the stroke, so undo puts the road back with the object.
        stripCoatingsFor(executor, gs, placeCmd.object);
        executor.execute(placeCmd);
        executor.commitStroke(strokeStart);

        // Update selection to the moved object's new geometry. setSelection, never toggle: Ctrl
        // pressed mid-drag would otherwise deselect the object the user just moved.
        const block = { kind: 'object', id: movedId } as const;
        useEditorStore.getState().setSelection([block]);
        return;
      }
      if (!dragging) {
        dragObjId = null;
        // A tap (no drag) on a member of a GROUP selects that member alone — an unmodified click
        // always ends with one thing selected. On a lone selected block it toggles the selection off.
        if (collapseToOnUp) {
          useEditorStore.getState().setSelection([{ kind: 'object', id: collapseToOnUp }]);
          collapseToOnUp = null;
        } else if (toggleOffOnUp) {
          useEditorStore.getState().clearSelection();
          toggleOffOnUp = false;
        }
      }
      if (e.button === PRIMARY_BUTTON) { leftPanning = false; gestures.navUp(); setCursorDrag('none'); }
      if (e.button === PRIMARY_BUTTON && panKeyPanning) {
        panKeyPanning = false;
        return;
      }
      if (e.button === PRIMARY_BUTTON && toolDown) {
        toolDown = false;
        tools()?.handlePointerUp(e.clientX, e.clientY);
      }
    };

    // The browser cancels touches (incoming call, edge swipe, palm rejection): abort any live
    // stroke like a pinch would, and drop every in-flight gesture state without committing.
    const onPointerCancel = (e: PointerEvent) => {
      leftPanning = false;
      panKeyPanning = false;
      if (e.pointerType === 'touch') {
        cancelTouchStroke(e.clientX, e.clientY);
        if (touchPinch.up(e.pointerId) === 0) touchNavigating = false;
        touchUndoStart = -1;
      }
      gestures.cancel();
      dragging = false;
      dragObjId = null;
      setCursorDrag('none');
      if (regionBrushing) { regionBrushing = false; finishRegionStroke(); }
      if (bandArmed) { bandArmed = false; bandActive = false; bandStartMacro = null; view()?.overlay.clearBand(); }
      view()?.overlay.clearGhost();
    };

    const onContextMenu = (e: MouseEvent) => {
      if (isCanvasTarget(e)) e.preventDefault();
    };

    // The non-primary click that follows a middle/right press. Suppressed for the same reason the
    // context menu is: those buttons drive the camera here. It has no effect on a browser-level
    // gesture handler — nothing a page does can — which is what `onGestureLost` is for.
    const onAuxClick = (e: MouseEvent) => {
      if (isNavButton(e.button) && isCanvasTarget(e)) e.preventDefault();
    };

    // A nav drag still armed when focus leaves never got its release.
    const onWindowBlur = () => gestures.windowBlurred();

    /**
     * Re-feeds the last known screen position to the tools + hover when something OTHER than a real
     * pointer event changed what that position means: the camera moving under a still cursor
     * (`onViewportChanged`), or the armed item's pending rotation flipping under a still cursor
     * (the placementRotation subscription below) — both leave a live brush stroke frozen on stale
     * cells, or the idle hover box / placement ghost tracking a cell/orientation a click would no
     * longer produce.
     *
     * Skipped whenever a live gesture already owns the pointer through a channel that bypasses
     * `tools()?.handlePointerMove` (an orbit/pan drag, the Hand tool's left-drag, an object drag, the
     * rubber band, the region brush, or a touch pinch): each of those gestures has its own bespoke
     * per-move handling instead, so feeding the tools here would not just duplicate a tick, it would
     * hand them a position update mid-gesture that the normal pointermove path deliberately withholds
     * from them.
     */
    const resamplePointer = () => {
      if (!pointerKnown) return;
      if (resampling) return;
      if (gestures.isNavigating() || leftPanning || panKeyPanning || dragging || bandArmed || regionBrushing || touchNavigating) return;
      resampling = true;
      try {
        tools()?.handlePointerMove(lastPointerX, lastPointerY);
        // Brushes/eraser/placer already got their re-sample above; the hover box and cursor hints are
        // the "no stroke active" half of the same fact, gated (inside updateSelectionHover) on the
        // hovered cell actually changing, same as a real drag.
        if (!toolDown) {
          updateSelectionHover({ clientX: lastPointerX, clientY: lastPointerY, pointerType: 'mouse', target: container });
        }
      } finally {
        resampling = false;
      }
    };
    // The viewport itself is a tool-INPUT source here, not just a render trigger: the world under an
    // unmoved screen point genuinely changed.
    const onViewportChanged = () => resamplePointer();
    const eventBus = useEditorStore.getState().eventBus;

    /**
     * Coalesced re-sample, for the two sources that arrive in BURSTS: a generate places thousands
     * of objects and a fill paints thousands of cells, each announcing itself, and the answer only
     * needs recomputing once before the next frame is drawn. Everything else below re-samples
     * straight away — a tool switch or a selection is one discrete action, and deferring those
     * would put a frame between the user acting and the cursor agreeing.
     */
    let queuedResample = 0;
    const queueResample = (): void => {
      if (queuedResample) return;
      queuedResample = requestAnimationFrame(() => { queuedResample = 0; resamplePointer(); });
    };
    // Bumped by the map-mutation events, so `hoverInputs` covers them too: they change the answer
    // without changing anything the store subscription can see (the grid mutates in place).
    const onMapChanged = (): void => { mapEpoch++; queueResample(); };
    eventBus.on('objects-changed', onMapChanged);
    eventBus.on('cells-changed', onMapChanged);
    // The tool layer, once it matches the store. Straight away, not queued: one mode press is one
    // discrete action, and the store's own subscription has already re-sampled against the tool
    // being left, so this is the pass that gets the answer right.
    const onToolSynced = (): void => { toolEpoch++; resamplePointer(); };
    eventBus.on('tool-synced', onToolSynced);
    // Every other non-pointer input: the armed item, the active tool, the selection, the pending
    // rotation, region mode. One subscription over `hoverInputs` rather than one per field.
    let lastInputs = hoverInputs(useEditorStore.getState(), mapEpoch, toolEpoch, isMultiSelectHeld());
    const unsubInputs = useEditorStore.subscribe((state) => {
      const next = hoverInputs(state, mapEpoch, toolEpoch, isMultiSelectHeld());
      if (sameHoverInputs(lastInputs, next)) return;
      lastInputs = next;
      resamplePointer();
    });
    // A held key is not store state, so it announces itself rather than being subscribed to.
    const unsubMultiSelect = onMultiSelectChange(resamplePointer);

    // The hover preview and the positional cursor facts die with the pointer: leaving the canvas
    // (window edge) must not strand a grey box or a stale badge on the map.
    const onPointerLeave = (e: PointerEvent) => {
      view()?.overlay.clearHover();
      hoverCell = null;
      hoverInputsKey = null;
      pointerKnown = false; // gone: nothing left for the resampler to re-sample
      setCursorForbidden(false);
      setCursorOverSelected(false);
      setCursorCtrlHint(null);
      setCursorPressSelects(false);
      // A DRAG outlives the leave: orbiting to the window edge, or panning across a floating panel
      // with the pan-drag key held, is one continuous gesture, and pointerup/pointercancel own
      // clearing it. Only a leave with no button held means the gesture is over.
      if (e.buttons === 0) setCursorDrag('none');
    };

    installModifierTracking(); // Shift tracker for the shape brushes (idempotent)
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    container.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('wheel', onWheelGlobal, { passive: false });
    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('auxclick', onAuxClick);
    window.addEventListener('blur', onWindowBlur);
    eventBus.on('viewport-changed', onViewportChanged);

    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('wheel', onWheelGlobal);
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('blur', onWindowBlur);
      eventBus.off('viewport-changed', onViewportChanged);
      eventBus.off('objects-changed', onMapChanged);
      eventBus.off('cells-changed', onMapChanged);
      eventBus.off('tool-synced', onToolSynced);
      if (queuedResample) cancelAnimationFrame(queuedResample);
      unsubInputs();
      unsubMultiSelect();
    };
  }, []);
}
