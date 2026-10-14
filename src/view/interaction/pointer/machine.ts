/**
 * The pointer-gesture state machine both map views mount: right/middle-drag navigate, the wheel
 * zooms (a mouse notch steps, a touchpad scroll or pinch glides; see `camera-gestures.ts`),
 * left-click block select, and the modal gestures that own the pointer from press to release:
 * drag-to-move (`object-drag.ts`), the Ctrl rubber band (`band-select.ts`), the region brush
 * (`region-pointer.ts`) and touch (`touch-gesture.ts`), where a second finger switches to pinch-zoom
 * and pan, cancelling anything the first finger started. A right or middle tap opens the context
 * menu.
 *
 * `resolvePress` decides what a press means; this machine executes the plan, routes each move to
 * the gesture that owns it, and re-samples a still pointer when the world under it changes.
 */
import { clientPoint } from '../../../platform/device/viewport-space';
import { useEditorStore } from '../../../state/store';
import { getActiveToolManager, getActiveView } from '../../active-view';
import { setMapWheelSink } from '../map-wheel';
import { resolveNavTap, resolvePress, type PressFacts, type PressIntent, type PressPlan } from '../press/press-plan';
import { isNavButton, PRIMARY_BUTTON } from '../press/pointer-buttons';
import { createCameraGestures } from '../camera-gestures';
import { releaseTextFocus } from '../pointer-focus';
import { noteNavGestureLost } from '../nav-gesture-hint';
import { installKeyTracking } from '../../../platform/input/held-keys';
import { setCursorDrag, setCursorPressSelects } from '../cursor-controller';
import { buildPressFacts } from './press-facts';
import { HoverProbe, clearCursorFacts } from './hover-probe';
import { ObjectDrag } from './object-drag';
import { BandSelect } from './band-select';
import { TouchGesture } from './touch-gesture';
import { RegionPointer } from './region-pointer';
import { watchResampleTriggers } from './resampler';
import { armedItemOf } from '../../../state/editing/edit-mode';

type Point = { x: number; y: number };

/** The press the machine is executing, from its pointer down to its release. */
interface PressState {
  /** A tool stroke is open. */
  toolDown: boolean;
  /** A left drag pans (the press resolved as a pan in a select mode). */
  leftPanning: boolean;
  /** The pan-drag key's pan is live. */
  panKeyPanning: boolean;
  /** The press landed on the lone selected block: a tap (no drag) deselects it on release. */
  toggleOffOnUp: boolean;
  /** The press landed on a member of a plural selection: a tap selects that object alone, while a
   *  drag moves the whole group. */
  collapseToOnUp: string | null;
}

/**
 * The pointer's last known screen position while it is meaningfully "here": over this canvas, or
 * mid-stroke on it. Set on every real (non-touch) pointer down or move that reaches this container
 * or drives an active tool stroke; forgotten on pointerleave. A stationary pointer is still over a
 * moving cell when the camera pans by some other means (WASD, or any camera verb outside this
 * machine): re-sampling this position on a viewport change is what lets a live stroke keep painting,
 * and the hover and ghost keep tracking the cell they would actually land on.
 */
interface PointerMemory { x: number; y: number; known: boolean }

/**
 * A Ctrl gesture ended with something selected while an item was armed: the placement session is
 * over, so the item is dropped and the pointer lands in the ordinary select/drag mode.
 *
 * An empty result keeps the item armed: a band that caught nothing, or a toggle that emptied the
 * selection, leaves nothing to edit, so an accidental Ctrl-drag over bare ground must not cost the
 * user the item they picked in the panel.
 *
 * A brush/eraser/edge-cut gesture already left for the Hand tool: the store puts a brush away in
 * the update that writes a selection under it (`state/slices/engine.ts`).
 */
function disarmAfterCtrlSelect(hover: HoverProbe): void {
  const store = useEditorStore.getState();
  if (!armedItemOf(store)) return;
  if (store.selection.length === 0) return;
  store.setEditMode({ arm: { kind: 'none' } });
  getActiveView()?.overlay.clearGhost();
  // The positional cursor facts were resolved for the armed mode, and no pointer event follows a
  // key-driven mode change: drop them so the next move re-probes this cell.
  hover.cell = null;
  setCursorPressSelects(false);
}

/** Mounts the machine on `container`; returns the teardown. */
export function installPointerMachine(container: HTMLDivElement): () => void {
  const view = getActiveView;
  const tools = getActiveToolManager;
  // The camera half of this machine lives in `camera-gestures`, shared with the export shot
  // editor. What stays here is when a left drag pans, which depends on the tool and the
  // selection, and which the flags below gate the rest of the machine on.
  const gestures = createCameraGestures({
    camera: () => view()?.camera ?? null,
    onDragChange: setCursorDrag,
    onGestureLost: noteNavGestureLost,
  });
  const drag = new ObjectDrag();
  const band = new BandSelect();
  const touch = new TouchGesture(gestures);
  const region = new RegionPointer();
  const press: PressState = { toolDown: false, leftPanning: false, panKeyPanning: false, toggleOffOnUp: false, collapseToOnUp: null };
  const pointer: PointerMemory = { x: 0, y: 0, known: false };

  // Takes any event-like value with a `target` (a real DOM Event, or a PointerSample built for the
  // resampler below): both need the same test of whether it is over this machine's own canvas.
  function isCanvasTarget(e: { target: EventTarget | null }): boolean {
    const target = e.target;
    if (!(target instanceof Node)) return false; // window/document targets are never the canvas
    return container.contains(target);
  }
  const hover = new HoverProbe(isCanvasTarget);

  const remember = (at: Point): void => { pointer.x = at.x; pointer.y = at.y; pointer.known = true; };
  /** The press's tap will never settle: it became a drag, or it ended. The window's release
   *  reaches this machine for presses it never saw (a panel control, the other view), so a flag
   *  left standing would act on one of those. */
  const forgetTap = (): void => { press.toggleOffOnUp = false; press.collapseToOnUp = null; };

  /** A second finger landed (or the touch was cancelled) while a touch stroke was live: the tool
   *  cancels its press and rolls back what it committed, since the finger meant to navigate. */
  const cancelTouchStroke = () => {
    region.cancel();
    if (!press.toolDown) return;
    press.toolDown = false;
    tools()?.handlePointerCancel();
    view()?.overlay.clearGhost();
  };

  /** A second finger landed: cancel whatever the first finger started (stroke, drag, region
   *  brush), since the gesture is navigation from here. */
  const abandonForNavigation = () => {
    cancelTouchStroke();
    drag.cancel();
    setCursorDrag('none');
    forgetTap();
    view()?.overlay.clearGhost();
  };

  // Wheel input over the canvas, routed by intent in `camera-gestures.ts`. Ctrl+scroll (including
  // the synthesized ctrl+wheel of a trackpad pinch) is the active-view registry's one window
  // listener (`active-view.ts`), so it zooms once even with both views mounted.
  const onWheel = (e: WheelEvent) => {
    if (!isCanvasTarget(e) || e.ctrlKey) return;
    e.preventDefault();
    gestures.wheel(e);
  };

  /** Perform one intent: every mechanism the machine has, addressed by name. `at` is the event's
   *  layout point. */
  const runIntent = (intent: PressIntent, e: PointerEvent, at: Point, f: PressFacts): void => {
    const store = useEditorStore.getState();
    switch (intent.kind) {
      case 'pan-camera':
        if (intent.source === 'pan-key') press.panKeyPanning = true;
        else press.leftPanning = true;
        gestures.panFrom(at.x, at.y);
        return;
      case 'paint-region':
        region.begin(at.x, at.y);
        return;
      case 'tool-stroke':
        press.toolDown = true;
        // A tool-owned grab (a selected note) moves under the same closed hand as selected objects.
        if (f.toolGrabs && !f.multiSelectHeld) {
          setCursorDrag('object');
        }
        tools()?.handlePointerDown(at.x, at.y, e.timeStamp);
        return;
      case 'select':
        store.setSelection([intent.block]);
        return;
      case 'toggle-select':
        store.toggleSelection(intent.block);
        return;
      case 'deselect':
        press.toggleOffOnUp = true;
        return;
      case 'collapse-select':
        press.collapseToOnUp = intent.id;
        return;
      case 'move-selection':
        drag.arm(intent.anchorId, at.x, at.y, f.macro);
        return;
      case 'band-select':
        band.arm(intent.from, at.x, at.y);
        // Neither the armed item's placement preview nor a brush's paint preview has anything
        // left to show: this gesture selects.
        view()?.overlay.clearGhost();
        return;
      case 'context-menu':
        store.setContextMenu({ x: at.x, y: at.y, target: intent.block });
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
   * The order is the machine's, not the plan's: the selection write, then the flags a tap or a
   * drag will read, then the tool stroke. `handlePointerDown` executes commands, so the stroke
   * runs last, with everything else this press sets already in place. A plan never carries a
   * stroke alongside a move or a band (arming either is what withholds the press from the tool),
   * so the only pair this reorders is the stroke against the pan the same press arms.
   */
  const runPlan = (p: PressPlan, e: PointerEvent, at: Point, f: PressFacts): void => {
    for (const i of p.down) if (i.kind !== 'tool-stroke') runIntent(i, e, at, f);
    for (const i of p.onTap) runIntent(i, e, at, f);
    for (const i of p.onDrag) runIntent(i, e, at, f);
    for (const i of p.down) if (i.kind === 'tool-stroke') runIntent(i, e, at, f);
  };

  /** A left press: pan with the pan-drag key, paint a region, resolve the selection, or start a
   *  tool stroke, whichever `resolvePress` says this one means. */
  const leftDown = (e: PointerEvent, at: Point): void => {
    if (e.button !== PRIMARY_BUTTON) return;
    e.preventDefault();
    const f = buildPressFacts(PRIMARY_BUTTON, at.x, at.y);
    if (!f) return;
    const plan = resolvePress(f);
    // Navigate-while-drawing: the pan-drag key is the camera, not an edit, so it leaves the hover
    // preview and any open popover exactly as it found them.
    const panKey = plan.down.find((i) => i.kind === 'pan-camera' && i.source === 'pan-key');
    if (panKey) { runIntent(panKey, e, at, f); return; }
    // The press resolves the hover preview: either into a real selection (which paints the
    // selection marks) or into a tool stroke.
    view()?.overlay.clearHover();
    // The region brush owns the pointer outright, down to leaving an open context menu alone.
    const paint = plan.down.find((i) => i.kind === 'paint-region');
    if (paint) { runIntent(paint, e, at, f); return; }
    const store = useEditorStore.getState();
    store.setContextMenu(null);
    store.setDeletePopover(null);
    forgetTap();
    runPlan(plan, e, at, f);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!isCanvasTarget(e)) return;
    releaseTextFocus(container);
    const at = clientPoint(e);

    // Touch has no meaningful "position" once the finger lifts, so it never feeds the resampler.
    if (e.pointerType !== 'touch') remember(at);

    if (touch.down(e, abandonForNavigation)) return;
    // Right or middle press: arm camera navigation. A tap opens the context menu on release.
    if (gestures.navDown(e)) return;
    leftDown(e, at);
  };

  /** Pan-drag key held, or a select-mode left drag: slide the camera and consume the move. */
  const panMove = (e: PointerEvent): boolean => {
    if (press.panKeyPanning) { gestures.panStep(e); return true; }
    // A left pan needs the button still down and a real pointer: a release outside the window
    // leaves the flag set, and touch pans through the pinch tracker instead.
    if (press.leftPanning && (e.buttons & 1) !== 0 && e.pointerType !== 'touch') {
      gestures.panStep(e);
      return true;
    }
    return false;
  };

  /** The tools hear the move: while a stroke is down, the browser's coalesced moves (the positions
   *  it captured but batched into this event) replay, so a fast drag samples its real trajectory
   *  instead of one far jump; a hover needs only the final position. */
  const feedTools = (e: PointerEvent, at: Point): void => {
    const coalesced = press.toolDown ? e.getCoalescedEvents?.() : undefined;
    if (coalesced && coalesced.length > 1) {
      for (const ce of coalesced) {
        const p = clientPoint(ce);
        tools()?.handlePointerMove(p.x, p.y, ce.timeStamp);
      }
    } else {
      tools()?.handlePointerMove(at.x, at.y, e.timeStamp);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const at = clientPoint(e);
    // "Here" means either this container is literally under the pointer, or a stroke already
    // started on it (a mid-stroke drag stays live even if the browser occasionally reports a target
    // outside the element, the same condition the tool feed below uses).
    if (e.pointerType !== 'touch' && (press.toolDown || isCanvasTarget(e))) remember(at);
    if (panMove(e)) return;
    if (touch.move(e, press.leftPanning)) return;
    // Right or middle drag: orbit the camera where the view has one, otherwise pan.
    if (gestures.navMove(e)) return;
    if (band.move(at.x, at.y)) return;
    if (region.move(at.x, at.y)) return;
    if (drag.move(at.x, at.y)) return;
    if (region.hover(at.x, at.y, isCanvasTarget(e) && e.pointerType !== 'touch')) return;
    if (!drag.dragging && (press.toolDown || isCanvasTarget(e))) feedTools(e, at);
    // Idle mouse hover: preview what a click would select as a grey box.
    if (!press.toolDown && !drag.dragging) hover.update(e);
  };

  /** The Ctrl band's release. A tool-owned select state runs its own press under the band (the
   *  plan pairs them), so that stroke closes here first. */
  const releaseBand = (e: PointerEvent, at: Point): boolean => {
    if (!band.armed) return false;
    if (press.toolDown) {
      press.toolDown = false;
      tools()?.handlePointerUp(at.x, at.y, e.timeStamp);
    }
    band.release(at.x, at.y);
    disarmAfterCtrlSelect(hover);
    return true;
  };

  /** A right or middle release. A tap targets whatever is under the pointer when it lifts, not
   *  where it landed, so the facts are gathered here rather than carried from the press. */
  const releaseNav = (e: PointerEvent, at: Point): boolean => {
    if (!isNavButton(e.button)) return false;
    const nav = gestures.navUp();
    if (nav.navigated && !nav.moved) {
      const f = buildPressFacts(e.button, at.x, at.y);
      if (f) for (const intent of resolveNavTap(f)) runIntent(intent, e, at, f);
    }
    return true;
  };

  /** The region brush's release. */
  const releaseRegion = (e: PointerEvent): boolean => {
    if (!region.release(e.timeStamp)) return false;
    if (e.pointerType === 'touch') view()?.overlay.clearGhost();
    else resamplePointer();
    return true;
  };

  /** A tap (no drag) on a member of a group selects that member alone: an unmodified click always
   *  ends with one thing selected. On a lone selected block it toggles the selection off. */
  const settleTap = (): void => {
    if (drag.dragging) return;
    drag.cancel();
    if (press.collapseToOnUp) {
      useEditorStore.getState().setSelection([{ kind: 'object', id: press.collapseToOnUp }]);
      press.collapseToOnUp = null;
    } else if (press.toggleOffOnUp) {
      useEditorStore.getState().clearSelection();
      press.toggleOffOnUp = false;
    }
  };

  /** The primary button's own release: the pan ends, and an open stroke closes. */
  const releasePrimary = (e: PointerEvent, at: Point): void => {
    if (e.button !== PRIMARY_BUTTON) return;
    press.leftPanning = false;
    gestures.navUp();
    setCursorDrag('none');
    if (press.panKeyPanning) { press.panKeyPanning = false; return; }
    if (!press.toolDown) return;
    press.toolDown = false;
    tools()?.handlePointerUp(at.x, at.y, e.timeStamp);
    if (e.pointerType === 'touch') view()?.overlay.clearGhost();
    else resamplePointer();
  };

  /** A release goes to the first gesture that owns it, in this order: touch navigation, the band,
   *  a nav button, the region brush, an object drop; anything else settles a tap and releases the
   *  primary button. */
  const onPointerUp = (e: PointerEvent) => {
    if (touch.up(e)) return; // navigation fingers never reach the tool/select paths
    const at = clientPoint(e);
    if (releaseBand(e, at) || releaseNav(e, at) || releaseRegion(e)) return;
    if (drag.dragging && drag.objectId) {
      forgetTap();
      drag.drop(at.x, at.y);
      return;
    }
    settleTap();
    releasePrimary(e, at);
  };

  // The browser cancels touches (incoming call, edge swipe, palm rejection): abort any live
  // stroke like a pinch would, and drop every in-flight gesture state without committing.
  const onPointerCancel = (e: PointerEvent) => {
    press.leftPanning = false;
    press.panKeyPanning = false;
    if (e.pointerType === 'touch') {
      cancelTouchStroke();
      touch.cancelled(e);
    } else if (press.toolDown) {
      press.toolDown = false;
      tools()?.handlePointerCancel();
    }
    gestures.cancel();
    drag.cancel();
    forgetTap();
    setCursorDrag('none');
    region.cancel();
    band.cancel();
    view()?.overlay.clearGhost();
  };

  const onContextMenu = (e: MouseEvent) => {
    if (isCanvasTarget(e)) e.preventDefault();
  };

  // The non-primary click that follows a middle/right press. Suppressed for the same reason the
  // context menu is: those buttons drive the camera here. It has no effect on a browser-level
  // gesture handler (nothing a page does can), which is what `onGestureLost` is for.
  const onAuxClick = (e: MouseEvent) => {
    if (isNavButton(e.button) && isCanvasTarget(e)) e.preventDefault();
  };

  // A nav drag still armed when focus leaves never got its release.
  const onWindowBlur = () => gestures.windowBlurred();

  /**
   * Re-feeds the last known screen position to the tools and hover when something other than a
   * pointer event changed what it means: the camera moving under a still cursor, or the armed
   * item's rotation changing. Otherwise a live stroke freezes on stale cells and the hover box or
   * ghost tracks a cell a click would no longer hit. Skipped while a gesture owns the pointer
   * through its own move handling (orbit or pan, an object drag, the band, the region brush, a
   * pinch), which the tools must not hear mid-gesture. Every camera move a gesture makes happens
   * under one of those flags, so a re-sample never feeds the 'viewport-changed' it answers.
   */
  function resamplePointer(): void {
    if (!pointer.known) return;
    if (gestures.isNavigating() || press.leftPanning || press.panKeyPanning || drag.dragging || band.armed || region.painting || touch.navigating) return;
    if (region.hover(pointer.x, pointer.y, true)) return;
    tools()?.handlePointerMove(pointer.x, pointer.y);
    // Brushes/eraser/placer already got their re-sample above; the hover box and cursor hints are
    // the "no stroke active" half of the same fact, gated (inside the hover probe) on the hovered
    // cell actually changing, same as a real drag.
    if (!press.toolDown) {
      hover.update({ clientX: pointer.x, clientY: pointer.y, pointerType: 'mouse', target: container });
    }
  }
  // The viewport is a tool input here, not only a render trigger: the world under an unmoved
  // screen point changed.
  const onViewportChanged = () => resamplePointer();
  const eventBus = useEditorStore.getState().eventBus;
  const unwatchTriggers = watchResampleTriggers(eventBus, hover, resamplePointer);

  // The hover preview and the positional cursor facts die with the pointer: leaving the canvas
  // (window edge) must not strand a grey box or a stale badge on the map.
  const onPointerLeave = (e: PointerEvent) => {
    view()?.overlay.clearHover();
    if (!press.toolDown && !region.painting) view()?.overlay.clearGhost();
    hover.forget();
    pointer.known = false; // gone: nothing left for the resampler to re-sample
    clearCursorFacts();
    // A drag outlives the leave: orbiting to the window edge, or panning across a floating panel
    // with the pan-drag key held, is one continuous gesture, and pointerup/pointercancel own
    // clearing it. Only a leave with no button held means the gesture is over.
    if (e.buttons === 0) setCursorDrag('none');
  };

  installKeyTracking(); // Shift tracker for the shape brushes (idempotent)
  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('wheel', onWheel, { passive: false });
  // Controls riding on the map forward the wheel they do not use (see map-wheel.ts).
  const releaseWheelSink = setMapWheelSink((e) => { e.preventDefault(); gestures.wheel(e); });
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
    releaseWheelSink();
    container.removeEventListener('contextmenu', onContextMenu);
    container.removeEventListener('auxclick', onAuxClick);
    window.removeEventListener('blur', onWindowBlur);
    eventBus.off('viewport-changed', onViewportChanged);
    unwatchTriggers();
  };
}
