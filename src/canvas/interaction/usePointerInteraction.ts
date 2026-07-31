import { useEffect, type RefObject } from 'react';
import { petitWindow } from '../../core/runtime/window-bridge';
import { useEditorStore } from '../../state/store';
import { getActiveToolManager, getActiveView } from '../active-view';
import type { ToolOverlay } from '../view-projection';
import { ToolType, CommandType } from '../../core/model/types';
import type { MacroCoord, GridState } from '../../core/model/types';
import type { BlockRef } from '../../state/store';
import { selectedObjectIds, singleSelection } from '../../state/selection';
import { groupMembers, moveGroup, previewGroupMove } from '../../ui/chrome/group-actions';
import { getCell, getFootprint } from '../../core/model/grid-model';
import { planObjectMove, GHOST_VALID, GHOST_INVALID } from '../../tools/objects/object-placer';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { surfaceElevation } from '../../core/edge-cut/terrain-silhouette';
import { arcMotion, arcOffset, type GroupRotation } from '../group-arc';
import {
  armedPressSelects, canHoldSelection, inSelectMode, isBrushTool, isDraggableObject, objectUnderPointer,
  overSelectedObject, selectionHoverBox,
} from './selection-hover';
import { WheelClassifier, TouchPinch, pinchWheelFactor } from './gestures';
import { macroRect, objectsInBand } from './marquee';
import { installModifierTracking, isSpaceHeld, isMultiSelectHeld } from '../../core/runtime/modifier-state';
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
 * rendered box is already at that shape by the time any tween frame runs (verified: `objects-changed`
 * rebuilds it synchronously before the animation is even started) — drawing a ring at any other shape
 * would disagree with what is already on screen. Only the CENTRE travels.
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

/** The ids a drag anchored on `anchorId` carries, or null when it carries that object alone:
 *  the whole selection, when it is plural and the anchor belongs to it. */
function groupDragIds(sel: readonly BlockRef[], anchorId: string): string[] | null {
  if (sel.length < 2) return null;
  const ids = selectedObjectIds(sel);
  return ids.length > 1 && ids.includes(anchorId) ? ids : null;
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

    let rightPanning = false;
    let leftPanning = false;
    let rightDownX = 0;
    let rightDownY = 0;
    let rightMoved = false;
    let panLastX = 0;
    let panLastY = 0;
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
    const DRAG_THRESHOLD = 3;
    // Touch: active points + pinch math live in TouchPinch; `touchNavigating` flips on when a
    // second finger lands and stays on until every finger lifts (fingers navigate, they never
    // draw mid-gesture). `touchUndoStart` is the undo-stack watermark taken when a single touch
    // starts a tool stroke, so a pinch can cancel whatever that finger already painted.
    const touchPinch = new TouchPinch();
    let touchNavigating = false;
    let touchUndoStart = -1;
    const wheelClassifier = new WheelClassifier();

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
      store.setSelectedItemId(null);
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
      store.setActiveTool(ToolType.Hand);
      // The Build panel highlights its tile from `designMode`, not from the active tool, so leaving
      // it on the brush would show a brush as current while the pointer is in select/drag mode.
      store.setDesignMode('hand');
    };

    const el = container;
    // Takes any event-like value with a `target` (a real DOM Event, or a PointerSample built for the
    // resampler below) — both need the same "is this actually over MY canvas" test.
    function isCanvasTarget(e: { target: EventTarget | null }): boolean {
      const target = e.target;
      if (!(target instanceof Node)) return false; // window/document targets are never the canvas
      return el.contains(target);
    }

    const zoomMapAt = (e: WheelEvent) => {
      view()?.camera.zoomStep(e.deltaY > 0 ? -1 : 1, e.clientX, e.clientY);
    };

    /** Smooth, magnitude-proportional zoom (pinch / ctrl+wheel) anchored at the cursor. */
    const pinchZoomAt = (e: WheelEvent) => {
      view()?.camera.zoomBy(pinchWheelFactor(e.deltaY), e.clientX, e.clientY);
    };

    // Wheel input over the canvas, routed by INTENT: a mouse notch keeps the classic stepped
    // zoom; a touchpad two-finger scroll PANS (see gestures.ts for the rationale). Ctrl+scroll
    // (incl. the synthesized ctrl+wheel of a trackpad pinch) is handled globally below so it
    // zooms even when the cursor is over a panel.
    const onWheel = (e: WheelEvent) => {
      if (!isCanvasTarget(e) || e.ctrlKey) return;
      e.preventDefault();
      // Horizontal scroll (a mouse tilt-wheel or a trackpad sideways swipe): the 3D view ORBITS
      // (yaw) so the optional hscroll spins the camera; the 2D view pans horizontally. Only fires
      // when the horizontal component clearly dominates, so ordinary vertical scroll is untouched.
      const cam = view()?.camera;
      if (cam && Math.abs(e.deltaX) > Math.abs(e.deltaY) && e.deltaX !== 0) {
        const k = e.deltaMode === 1 ? 16 : 1;
        if (cam.wheelZooms && cam.orbit) cam.orbit(e.deltaX * k, 0);
        else cam.pan(e.deltaX * k, 0);
        return;
      }
      const intent = wheelClassifier.classify(e, performance.now());
      if (intent === 'scroll-pan') {
        // The 3D camera opts into zoom-on-scroll (a ground-plane pan there reads as
        // W/S); the 2D view keeps touchpad-scroll panning.
        if (view()?.camera.wheelZooms) pinchZoomAt(e);
        else {
          const k = e.deltaMode === 1 ? 16 : 1; // LINE deltas (rare here) → approx px
          view()?.camera.pan(e.deltaX * k, e.deltaY * k);
        }
      } else {
        zoomMapAt(e);
      }
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
      pinchZoomAt(e);
    };

    let regionBrushing = false;
    let spacePanning = false;

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
          toggleOffOnUp = false;
          collapseToOnUp = null;
          view()?.overlay.clearGhost();
          if (regionBrushing) { regionBrushing = false; petitWindow().__petitRegionBrushDone?.(); }
          touchNavigating = true;
          return true;
        }
        if (count > 2) { e.preventDefault(); return true; } // extra fingers join the navigation gesture
        if (touchNavigating) { e.preventDefault(); return true; } // still mid-gesture (shouldn't happen: count===1 here)
        // Single finger falls through to the normal (tool/select) path; take the undo watermark
        // so a pinch can cleanly cancel anything this finger paints.
        touchUndoStart = useEditorStore.getState().commandExecutor?.getUndoStackSize() ?? -1;
      }

      return false;
    };

    /** Right or middle press: arm camera navigation. A tap opens the context menu on release. */
    const orbitDown = (e: PointerEvent): boolean => {
      if (e.button === 2 || e.button === 1) {
        e.preventDefault();
        // MIDDLE is a second RIGHT: both navigate the camera, so a mouse without a
        // usable right button (or a hand already on the wheel) loses nothing. A tap
        // (no drag) opens the context menu on pointer-up; a drag rotates the camera
        // where the view can orbit and pans where it cannot (2D). Panning stays on
        // left-drag in Hand mode, Space+left-drag, and WASD.
        rightPanning = true;
        rightMoved = false;
        rightDownX = e.clientX;
        rightDownY = e.clientY;
        panLastX = e.clientX;
        panLastY = e.clientY;
        setCursorDrag(view()?.camera.orbit ? 'orbit' : 'pan');
        return true;
      }
      return false;
    };

    /** What a left press landed on, resolved once and shared by both selection paths. */
    interface PressFacts {
      store: ReturnType<typeof useEditorStore.getState>;
      activeDown: ReturnType<typeof getActiveView>;
      ctrl: boolean;
      armed: boolean;
      brushCtrl: boolean;
      inDragMode: boolean;
      pressMacro: MacroCoord | null;
      pressHit: ReturnType<typeof objectUnderPointer> | null;
    }

    /** Apply the selection a left press implies, given what it landed on.
     *
     *  Returns true when the press was CONSUMED by the selection: an armed item selected the
     *  object in the way instead of placing on it, so the tool must not also see this press.
     *  Every other path leaves the press live — a plain click that selects still falls through to
     *  the Hand tool, which is what lets the same drag pan the camera. */
    const applySelectionPress = (e: PointerEvent, f: PressFacts): boolean => {
      const { store, activeDown, ctrl, armed, brushCtrl, inDragMode, pressMacro, pressHit } = f;
      if ((inDragMode || (armed && ctrl) || brushCtrl) && store.gridState && activeDown && pressMacro) {
        const macro = pressMacro;
        const hitObj = pressHit;
        const sel = singleSelection(store.selection);
        if (hitObj) {
          const block = { kind: 'object', id: hitObj.id } as const;
          if (ctrl) {
            // Ctrl+click toggles membership and never arms a drag (a held Ctrl+drag starts
            // the rubber band instead), so moving is reachable only through an unmodified press.
            // A brush tool leaves terrain-editing mode BEFORE the write (see
            // leaveBrushForSelection): selection starts empty in brush mode, so this toggle is
            // always an ADD, guaranteed to leave the selection non-empty.
            leaveBrushForSelection();
            store.toggleSelection(block);
          } else {
            // Drag-to-move arms only on a press over an object that is already selected; a
            // press on any other object selects it and then falls through to the Hand tool,
            // so the drag pans the camera. MEMBERSHIP, not identity: with a plural selection
            // the press picks the group up by whichever member it landed on.
            const alreadySelected = store.selection.some((r) => r.kind === 'object' && r.id === hitObj.id);
            if (alreadySelected) {
              // Re-clicking a selected object arms the tap behaviour (deselect for a
              // lone member, collapse to it for a group); a drag still moves.
              if (store.selection.length > 1) collapseToOnUp = hitObj.id;
              else toggleOffOnUp = true;
            } else {
              store.setSelection([block]);
            }
            if (alreadySelected && isDraggableObject(hitObj)) {
              dragObjId = hitObj.id;
              dragStartX = e.clientX;
              dragStartY = e.clientY;
              grabOffsetX = hitObj.position.x - macro.x;
              grabOffsetY = hitObj.position.y - macro.y;
              lastDragGhostKey = null;
            }
          }
        } else if (ctrl) {
          // Ctrl press on bare ground leaves the selection untouched: terrain never joins a
          // group, and the rubber-band DRAG (not this press) is what starts a marquee.
        } else if (sel?.kind === 'terrain' && sel.x === macro.x && sel.y === macro.y) {
          // Re-clicking the selected terrain cell deselects it on pointer-up.
          toggleOffOnUp = true;
        } else {
          // Select the terrain/ground cell
          const block = { kind: 'terrain', x: macro.x, y: macro.y } as const;
          store.setSelection([block]);
        }
        // Arm the band on ANY Ctrl-held press here, hit or not: a drag from an object is still
        // a band (Ctrl never moves anything, so dragObjId is never set in this branch).
        if (ctrl) {
          bandArmed = true;
          bandStartMacro = macro;
          bandStartX = e.clientX;
          bandStartY = e.clientY;
          // Neither the armed item's placement preview nor a brush's paint-preview ghost has
          // anything left to preview: this gesture selects.
          if (armed || brushCtrl) activeDown.overlay.clearGhost();
        }
      } else if (armed && store.gridState && activeDown && pressMacro) {
        // An item is armed and Ctrl is not held: rather than attempt a placement that would be
        // refused, a press on the EXISTING object in the way selects it (so it can be rotated or
        // deleted from the handles) and leaves the item armed to carry on placing.
        const tool = tools()?.getActiveTool();
        const ctx = tools()?.getContext();
        const placementAllowed = !tool?.canActAt || !ctx || tool.canActAt(pressMacro, ctx);
        if (pressHit && armedPressSelects(
          store.activeTool, store.selectedItemId, store.selectingRegion, ctrl, pressHit, placementAllowed,
        )) {
          const block = { kind: 'object', id: pressHit.id } as const;
          store.setSelection([block]);
          return true;
        }
      }
      return false;
    };

    /** A left press: pan with Space, paint a region, resolve the selection, or start a tool stroke. */
    const leftDown = (e: PointerEvent): void => {
      // Left button
      if (e.button === 0) {
        e.preventDefault();
        // Space + left-drag pans in ANY tool mode — the navigate-while-drawing
        // escape hatch, so the brush never has to fight the camera.
        if (isSpaceHeld() && isCanvasTarget(e)) {
          spacePanning = true;
          panLastX = e.clientX;
          panLastY = e.clientY;
          setCursorDrag('pan');
          return;
        }
        // The press resolves the hover preview: either into a real selection
        // (which paints the orange ring) or into a tool stroke.
        view()?.overlay.clearHover();
        // Check if region brush is active (priority over tools)
        const activeDown = view();
        if (useEditorStore.getState().selectingRegion && activeDown) {
          const macro = activeDown.projection.screenToMacro(e.clientX, e.clientY);
          const cb = petitWindow().__petitRegionBrushCallback;
          cb?.(macro);
          regionBrushing = true;
          return;
        }
        // Block selection — in drag mode (Hand, or idle ObjectPlacer), and with an item ARMED under
        // the multi-select modifier: reaching for Ctrl means the user is selecting, not placing
        // (a gesture that ends with something selected then drops the armed item on release).
        const store = useEditorStore.getState();
        store.setContextMenu(null);
        store.setDeletePopover(null);
        toggleOffOnUp = false;
        collapseToOnUp = null;
        const ctrl = isMultiSelectHeld();
        const armed = store.activeTool === ToolType.ObjectPlacer && !!store.selectedItemId;
        // A build brush (terrain/eraser/edge-cut) is normally paint-only, but Ctrl reaches the
        // selection path from it exactly as from an armed placer: the user reaching for the
        // modifier means "select", not "paint".
        const brushCtrl = ctrl && isBrushTool(store.activeTool);
        const inDragMode = inSelectMode(store.activeTool, store.selectedItemId);
        // What the press landed on, resolved ONCE for both paths below: mesh-precise pick first
        // (a tree's canopy selects the tree), then the footprint test, which covers flat items
        // and views without mesh picking.
        const pressMacro = (inDragMode || armed || brushCtrl) && store.gridState && activeDown
          ? activeDown.projection.screenToMacro(e.clientX, e.clientY)
          : null;
        const pressHit = pressMacro && store.gridState
          ? objectUnderPointer(
              store.gridState, pressMacro, activeDown?.projection.pickObject?.(e.clientX, e.clientY) ?? undefined,
            )
          : null;
        const armedSelected = applySelectionPress(e, {
          store, activeDown, ctrl, armed, brushCtrl, inDragMode, pressMacro, pressHit,
        });
        if (!dragObjId && !bandArmed && !armedSelected) {
          toolDown = true;
          // Navigate mode: a left-DRAG PANS the camera (grab the map — the same feel as the 2D
          // Hand tool). WHO pans depends on the view; the DRAG IS REPORTED HERE either way, and
          // exactly once, or nothing closes the hand cursor.
          if (inDragMode && activeDown) {
            if (activeDown.leftDragPans === false) {
              // The view does not pan left-drag itself (the 3D editor): the machine pans it.
              leftPanning = true;
              panLastX = e.clientX;
              panLastY = e.clientY;
              setCursorDrag('pan');
            } else if (store.activeTool === ToolType.Hand) {
              // 2D pans left-drag through ToolManager -> HandTool, so the machine must NOT pan
              // too. Gated on the Hand tool because that is the only tool ToolManager pans for.
              setCursorDrag('pan');
            }
          }
          tools()?.handlePointerDown(e.clientX, e.clientY);
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!isCanvasTarget(e)) return;

      // Touch has no meaningful "position" once the finger lifts, so it never feeds the resampler.
      if (e.pointerType !== 'touch') { lastPointerX = e.clientX; lastPointerY = e.clientY; pointerKnown = true; }

      if (touchDown(e)) return;
      if (orbitDown(e)) return;
      leftDown(e);
    };

    /** Space-held or nav-mode left drag: slide the camera and consume the move. */
    const panMove = (e: PointerEvent): boolean => {
      if (spacePanning) {
        view()?.camera.pan(panLastX - e.clientX, panLastY - e.clientY);
        panLastX = e.clientX;
        panLastY = e.clientY;
        return true;
      }
      if (leftPanning && (e.buttons & 1) !== 0 && e.pointerType !== 'touch') {
        view()?.camera.pan(panLastX - e.clientX, panLastY - e.clientY);
        panLastX = e.clientX;
        panLastY = e.clientY;
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
          const nav = view();
          if (delta && nav) {
            if (delta.scale !== 1) nav.camera.zoomBy(delta.scale, delta.midX, delta.midY);
            if (delta.panX !== 0 || delta.panY !== 0) nav.camera.pan(delta.panX, delta.panY);
            if (delta.twist !== 0) nav.camera.orbitTwist?.(delta.twist);
          }
          return true;
        }
        // One-finger drag in a nav-mode 3D view PANS the camera — the touch analog of the desktop
        // left-drag pan (2D already one-finger-pans via the Hand tool). leftPanning is set on
        // pointer-down only in Hand/idle mode on a view that doesn't pan left-drag itself (the 3D
        // editor). A second finger switches to the pinch/pan/twist gesture above.
        if (leftPanning && delta) {
          view()?.camera.pan(delta.panX, delta.panY);
          return true;
        }
      }
      return false;
    };

    /** Right or middle drag: orbit the camera where the view has one, otherwise pan. */
    const orbitMove = (e: PointerEvent): boolean => {
      if (rightPanning) {
        const nav = view();
        if (!nav) return true;
        if (Math.abs(e.clientX - rightDownX) > DRAG_THRESHOLD || Math.abs(e.clientY - rightDownY) > DRAG_THRESHOLD) {
          rightMoved = true;
        }
        if (nav.camera.orbit) {
          nav.camera.orbit(e.clientX - panLastX, e.clientY - panLastY);
        } else {
          nav.camera.pan(panLastX - e.clientX, panLastY - e.clientY);
        }
        panLastX = e.clientX;
        panLastY = e.clientY;
        return true;
      }
      return false;
    };

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
        if (macro) petitWindow().__petitRegionBrushCallback?.(macro);
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
        const macro = dragView.projection.screenToMacro(e.clientX, e.clientY);
        const gs = useEditorStore.getState().gridState;
        const executor = useEditorStore.getState().commandExecutor;
        const obj = gs?.objects.get(dragObjId!);
        if (obj && executor && gs) {
          const baseX = macro.x + grabOffsetX;
          const baseY = macro.y + grabOffsetY;
          const groupIds = groupDragIds(useEditorStore.getState().selection, dragObjId!);
          const dx = baseX - obj.position.x;
          const dy = baseY - obj.position.y;
          // Skip the whole rebuild when the GRABBED CELL hasn't moved: raw pointermove fires far
          // more often than the macro cell changes, and re-validating a group re-checks every
          // member (previewGroupMove lifts + re-places all of them) — a per-pixel re-run would
          // multiply that cost for nothing, since the drop cell (and everything derived from it)
          // is unchanged. Throttled on the cell, not a timer, per the ghost's own contract.
          const ghostKey = `${groupIds ? groupIds.join(',') : dragObjId}|${dx}|${dy}`;
          if (ghostKey === lastDragGhostKey) return true;
          lastDragGhostKey = ghostKey;

          if (groupIds) {
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
            dragView.overlay.showGroupPlacementGhost?.(
              members.map((m) => {
                const mx = m.position.x + dx, my = m.position.y + dy;
                return {
                  catalogId: m.catalogId, x: mx, y: my, rotation: m.rotation,
                  elevation: surfaceElevation(gs.cells[my]?.[mx]?.terrain ?? null),
                };
              }),
              valid,
            );
          } else {
            const size = getPlacedObjectSize(obj);
            const cells: MacroCoord[] = getFootprint(baseX, baseY, size.w, size.h);
            // Tint the drag ghost by whether the drop would be accepted, matching
            // the placement ghost (the commit re-checks the same way on release).
            const valid = planObjectMove(executor, gs, obj, baseX, baseY).errors.length === 0;
            dragView.overlay.showGhost(cells, valid ? GHOST_VALID : GHOST_INVALID, false);
            // The dragged object itself rides the cursor — the 3D view stands its
            // mesh at the drop cell, the 2D view its sprite. The mesh height must
            // follow the surface UNDER the cursor (moving across a terrace changes
            // the drop elevation), not the object's origin elevation.
            const dropElev = surfaceElevation(gs.cells[baseY]?.[baseX]?.terrain ?? null);
            dragView.overlay.showPlacementGhost?.(obj.catalogId, baseX, baseY, obj.rotation, valid, dropElev);
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
     *  a PointerEvent so the resampler can call it with the last known position (real PointerEvents
     *  satisfy PointerSample structurally, so every live call site is unaffected). */
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

      // The rule pipeline only runs on a hovered-CELL change, not per pointer-move.
      if (!hoverCell || hoverCell.x !== macro.x || hoverCell.y !== macro.y) {
        hoverCell = macro;
        const tool = tools()?.getActiveTool();
        const ctx = tools()?.getContext();
        // ONE probe feeds both the forbidden badge and the armed placer's select-instead-of-place
        // decision, so a cursor can never claim to refuse a cell whose press selects.
        const placementAllowed = !tool?.canActAt || !ctx || tool.canActAt(macro, ctx);
        setCursorForbidden(!placementAllowed);
        setCursorOverSelected(
          !!store.gridState && overSelectedObject(store.gridState, macro, store.selection, meshHit),
        );
        // Both hints below say what a press would SELECT, so both read one hit test. The gate
        // repeats onPointerDown's: the Hand tool and the ObjectPlacer (armed or not — Ctrl reaches
        // the selection path either way) select, and the region brush owns the pointer while it runs.
        // A build brush only joins them while Ctrl is actually held — unmodified, it still paints,
        // so the hint (and the tool cursor it would otherwise outrank) must not claim otherwise.
        const ctrlHeld = isMultiSelectHeld();
        const canSelect = !!store.gridState && !store.selectingRegion
          && (canHoldSelection(store.activeTool) || (ctrlHeld && isBrushTool(store.activeTool)));
        const hitObj = canSelect && store.gridState
          ? objectUnderPointer(store.gridState, macro, meshHit)
          : null;
        if (ctrlHeld && canSelect) {
          if (hitObj) {
            const already = store.selection.some((r) => r.kind === 'object' && r.id === hitObj.id);
            setCursorCtrlHint(already ? 'select-remove' : 'select-add');
          } else {
            setCursorCtrlHint('marquee');
          }
        } else {
          setCursorCtrlHint(null);
        }
        setCursorPressSelects(armedPressSelects(
          store.activeTool, store.selectedItemId, store.selectingRegion, ctrlHeld, hitObj, placementAllowed,
        ));
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
      if (e.button === 2 || e.button === 1) {
        const wasTap = rightPanning && !rightMoved;
        rightPanning = false;
        setCursorDrag('none');
        const tapView = view();
        if (wasTap && tapView) {
          const store = useEditorStore.getState();
          const inDragMode = inSelectMode(store.activeTool, store.selectedItemId);
          const gs = store.gridState;
          if (inDragMode && gs) {
            const macro = tapView.projection.screenToMacro(e.clientX, e.clientY);
            const hitObj = objectUnderPointer(
              gs, macro, tapView.projection.pickObject?.(e.clientX, e.clientY) ?? undefined,
            );
            const block = hitObj
              ? ({ kind: 'object', id: hitObj.id } as const)
              : ({ kind: 'terrain', x: macro.x, y: macro.y } as const);
            // The context menu targets whatever was tapped; the SELECTION follows the same Ctrl
            // rule as a left-click (toggle over an object, untouched over bare ground).
            store.setContextMenu({ x: e.clientX, y: e.clientY, target: block });
            if (isMultiSelectHeld()) {
              if (hitObj) store.toggleSelection(block);
            } else {
              store.setSelection([block]);
            }
          }
        }
        return;
      }
      if (regionBrushing) {
        regionBrushing = false;
        // Commit brushed region to React state
        const done = petitWindow().__petitRegionBrushDone;
        done?.();
        return;
      }
      if (dragging && dragObjId) {
        dragging = false;
        const movedId = dragObjId;
        dragObjId = null;
        const dropView = view();
        dropView?.overlay.clearGhost();

        const gs = useEditorStore.getState().gridState;
        const executor = useEditorStore.getState().commandExecutor;
        const obj = gs?.objects.get(movedId);
        if (!obj || !gs || !executor || !dropView) return;

        const macro = dropView.projection.screenToMacro(e.clientX, e.clientY);
        const newX = macro.x + grabOffsetX;
        const newY = macro.y + grabOffsetY;
        if (newX === obj.position.x && newY === obj.position.y) return;

        const groupIds = groupDragIds(useEditorStore.getState().selection, movedId);
        if (groupIds) {
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

        const { cmd: placeCmd, errors } = planObjectMove(executor, gs, obj, newX, newY);
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
      if (e.button === 0) { leftPanning = false; setCursorDrag('none'); }
      if (e.button === 0 && spacePanning) {
        spacePanning = false;
        return;
      }
      if (e.button === 0 && toolDown) {
        toolDown = false;
        tools()?.handlePointerUp(e.clientX, e.clientY);
      }
    };

    // The browser cancels touches (incoming call, edge swipe, palm rejection): abort any live
    // stroke like a pinch would, and drop every in-flight gesture state without committing.
    const onPointerCancel = (e: PointerEvent) => {
      leftPanning = false;
      if (e.pointerType === 'touch') {
        cancelTouchStroke(e.clientX, e.clientY);
        if (touchPinch.up(e.pointerId) === 0) touchNavigating = false;
        touchUndoStart = -1;
      }
      rightPanning = false;
      dragging = false;
      dragObjId = null;
      setCursorDrag('none');
      if (regionBrushing) { regionBrushing = false; petitWindow().__petitRegionBrushDone?.(); }
      if (bandArmed) { bandArmed = false; bandActive = false; bandStartMacro = null; view()?.overlay.clearBand(); }
      view()?.overlay.clearGhost();
    };

    const onContextMenu = (e: MouseEvent) => {
      if (isCanvasTarget(e)) e.preventDefault();
    };

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
      if (rightPanning || leftPanning || spacePanning || dragging || bandArmed || regionBrushing || touchNavigating) return;
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
    // The rotate shortcut (`,`/`.`) writes placementRotation straight into the store — no pointer
    // event runs alongside it — so the ghost drawn by ObjectPlacerTool.onPointerMove is otherwise
    // stuck at the old orientation until the cursor next moves for real.
    const unsubRotation = useEditorStore.subscribe((state, prevState) => {
      if (state.placementRotation !== prevState.placementRotation) resamplePointer();
    });

    // The hover preview and the positional cursor facts die with the pointer: leaving the canvas
    // (window edge) must not strand a grey box or a stale badge on the map.
    const onPointerLeave = (e: PointerEvent) => {
      view()?.overlay.clearHover();
      hoverCell = null;
      pointerKnown = false; // gone: nothing left for the resampler to re-sample
      setCursorForbidden(false);
      setCursorOverSelected(false);
      setCursorCtrlHint(null);
      setCursorPressSelects(false);
      // A DRAG outlives the leave: orbiting to the window edge, or space-panning across a floating
      // panel, is one continuous gesture, and pointerup/pointercancel own clearing it. Only a leave
      // with no button held means the gesture is over.
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
      eventBus.off('viewport-changed', onViewportChanged);
      unsubRotation();
    };
  }, []);
}
