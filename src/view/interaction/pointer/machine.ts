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
 * the gesture that owns it, and re-samples a still pointer when the world under it changes. A touch
 * press the plan holds back waits here, with the hold timer, until `resolvePending` names the arm
 * to run.
 */
import { clientPoint } from '../../../platform/device/viewport-space';
import { useEditorStore } from '../../../state/store';
import { getActiveToolManager, getActiveView } from '../../active-view';
import { setMapWheelSink } from '../map-wheel';
import { resolveNavTap, resolvePress, type PressFacts, type PressIntent, type PressPlan } from '../press/press-plan';
import { isNavButton, PRIMARY_BUTTON } from '../press/pointer-buttons';
import { modalityOf, pointerHovers, timingFor, travelledPast, type GestureTiming } from '../../../platform/input/gesture-timing';
import { resolvePending, type PendingFacts } from '../press/pending';
import { createCameraGestures } from '../camera-gestures';
import { releaseTextFocus } from '../pointer-focus';
import { noteNavGestureLost } from '../nav-gesture-hint';
import { installKeyTracking } from '../../../platform/input/held-keys';
import { holdEditInFlight } from '../../../state/edits-in-flight';
import { setCursorDrag, setCursorPressSelects } from '../cursor-controller';
import { buildPressFacts } from './press-facts';
import { HoverProbe, clearCursorFacts } from './hover-probe';
import { ObjectDrag } from './object-drag';
import { BandSelect } from './band-select';
import { TouchGesture } from './touch-gesture';
import { RegionPointer } from './region-pointer';
import { watchResampleTriggers } from './resampler';
import { dropAt, isCarried, registerCarryTarget, type CarryTarget } from './carry';
import { clearHoldPress, runTwoFingerTap, showHoldPress } from './gesture-channel';
import { activeToolOf, armedItemOf } from '../../../state/editing/edit-mode';
import type { ToolType } from '../../../state/editing/vocabulary';
import type { BlockRef } from '../../../state/selection';

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
  /** A Ctrl press on a selected member: its tap takes the member out of the selection. */
  toggleOnUp: BlockRef | null;
  /** A touch press waiting to learn whether it is a tap, a drag or a hold. */
  pending: PendingPress | null;
  /** A touch drag or hold carries the armed item's preview: the pointer that holds it, and the
   *  arming it began under. The release places the item where it lifts. */
  previewing: { pointerId: number; arming: PressArming } | null;
  /** The finger whose press magnifies the map: a stroke of a tool that `magnifies`, or a preview
   *  over this map. It stands until that finger's press ends, through a blur that hides the loupe. */
  loupe: number | null;
  /** A finger's tool stroke that may still be the first finger of a pan: the tool keeps its
   *  refusals until the press travels, is held or lifts (`confirmQuiet`). */
  quiet: QuietPress | null;
  /** The last waiting press that settled as a tap with a double-tap arm: where and when it lifted,
   *  and the selection before its tap ran, which the double tap leaves standing. */
  lastTap: { at: Point; time: number; selection: readonly BlockRef[] } | null;
}

/** A finger's tool stroke whose feedback waits: the finger, where it landed, its timing and the
 *  hold timer that confirms it. */
interface QuietPress { pointerId: number; from: Point; timing: GestureTiming; timer: ReturnType<typeof setTimeout> }

/** The tool and armed item a press was resolved for. */
interface PressArming { tool: ToolType; armedItemId: string | null }

const armingNow = (): PressArming => {
  const store = useEditorStore.getState();
  return { tool: activeToolOf(store), armedItemId: armedItemOf(store) };
};

const sameArming = (a: PressArming, b: PressArming): boolean =>
  a.tool === b.tool && a.armedItemId === b.armedItemId;

/** A press whose plan is `pending`, from its landing until it resolves. */
interface PendingPress {
  pointerId: number;
  /** The landing event, which the hold arm runs against. */
  down: PointerEvent;
  plan: PressPlan;
  /** The facts at the landing: every arm acts on what the finger landed on. */
  facts: PressFacts;
  /** The landing point, in layout px. */
  from: Point;
  /** Travel from `from`, in layout px. */
  dx: number;
  dy: number;
  /** Where the last swallowed move left the finger: the pinch tracker's baseline. */
  last: Point;
  timing: GestureTiming;
  /** What the plan was resolved for. */
  arming: PressArming;
  /** The hold timer ran out with nothing to open: a release now does nothing, a drag still drags. */
  held: boolean;
  timer: ReturnType<typeof setTimeout>;
  /** The hold ring this press shows (`gesture-channel.ts:showHoldPress`), or null. */
  ring: number | null;
}

/**
 * The pointer's last known screen position while it is meaningfully "here": over this canvas, or
 * mid-stroke on it. Set on every real (non-touch) pointer down or move that reaches this container
 * or drives an active tool stroke; forgotten on pointerleave. A stationary pointer is still over a
 * moving cell when the camera pans by some other means (WASD, or any camera verb outside this
 * machine): re-sampling this position on a viewport change is what lets a live stroke keep painting,
 * and the hover and ghost keep tracking the cell they would actually land on.
 */
interface PointerMemory { x: number; y: number; known: boolean; pointerType: string }

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
  const touch = new TouchGesture(gestures, runTwoFingerTap);
  const region = new RegionPointer();
  const press: PressState = {
    toolDown: false, leftPanning: false, panKeyPanning: false, toggleOffOnUp: false, collapseToOnUp: null, toggleOnUp: null,
    pending: null, previewing: null, loupe: null, lastTap: null, quiet: null,
  };
  const pointer: PointerMemory = { x: 0, y: 0, known: false, pointerType: 'mouse' };
  /** The release of this machine's hold on the live map (`state/edits-in-flight.ts`) while its press
   *  can still change the map: a tool stroke, an object drag or an item preview. */
  let mapHold: (() => void) | null = null;
  /** Holds or lets go of the live map as the press opens or ends an edit; run after every handler. */
  const syncMapHold = (): void => {
    const editing = press.toolDown || drag.objectId !== null || press.previewing !== null;
    if (editing && !mapHold) mapHold = holdEditInFlight(() => abortPress(), 'hand');
    else if (!editing && mapHold) {
      const release = mapHold;
      mapHold = null;
      release();
    }
  };
  /** `handler`, followed by the hold's sync with whatever it left the press doing. */
  const thenSyncHold = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A): void => {
    try { handler(...args); } finally { syncMapHold(); }
  };

  // Takes any event-like value with a `target` (a real DOM Event, or a PointerSample built for the
  // resampler below): both need the same test of whether it is over this machine's own canvas.
  function isCanvasTarget(e: { target: EventTarget | null }): boolean {
    const target = e.target;
    if (!(target instanceof Node)) return false; // window/document targets are never the canvas
    return container.contains(target);
  }
  const hover = new HoverProbe(isCanvasTarget);

  const remember = (at: Point, pointerType: string): void => {
    pointer.x = at.x; pointer.y = at.y; pointer.known = true; pointer.pointerType = pointerType;
  };
  /** The press's tap will never settle: it became a drag, or it ended. The window's release
   *  reaches this machine for presses it never saw (a panel control, the other view), so a flag
   *  left standing would act on one of those. */
  const forgetTap = (): void => { press.toggleOffOnUp = false; press.collapseToOnUp = null; press.toggleOnUp = null; };

  /** A finger's press magnifies the map under `at`; a mouse or a pen, which shows its own hover
   *  and leaves the cells in sight, never does. */
  const showLoupe = (e: { pointerType: string; pointerId: number }, at: Point): void => {
    if (pointerHovers(e)) return;
    press.loupe = e.pointerId;
    view()?.showLoupe(at);
  };
  const hideLoupe = (): void => {
    if (press.loupe === null) return;
    press.loupe = null;
    view()?.hideLoupe();
  };
  /** A finger's stroke magnifies when its tool does under the arming and the press's drag stays the
   *  stroke; a press whose drag the plan gave to the camera or the band is a click. */
  const magnifyStroke = (e: PointerEvent, at: Point): void => {
    if (!press.toolDown || press.leftPanning || band.armed) return;
    const mgr = tools();
    const tool = mgr?.getActiveTool();
    const ctx = mgr?.getContext();
    if (tool && ctx && tool.magnifies?.(ctx)) showLoupe(e, at);
  };

  /** The waiting press is over: it resolved, or the gesture ended without it. */
  const endPending = (): void => {
    if (!press.pending) return;
    clearTimeout(press.pending.timer);
    // Only this press's ring: a card held by another finger may be showing its own.
    if (press.pending.ring !== null) clearHoldPress(press.pending.ring);
    press.pending = null;
  };

  /** The quiet stroke is over without standing: it lifted, or it was taken back. */
  const endQuiet = (): void => {
    if (!press.quiet) return;
    clearTimeout(press.quiet.timer);
    press.quiet = null;
  };

  /** The quiet stroke stands: what the tool kept is reported, and the stroke speaks from here. */
  const confirmQuiet = (): void => {
    if (!press.quiet) return;
    endQuiet();
    tools()?.confirmPress();
  };

  /** A finger's stroke is quiet: a second finger may yet land and make it a pan. */
  const beginQuiet = (e: PointerEvent, at: Point): void => {
    endQuiet();
    const timing = timingFor(e);
    press.quiet = { pointerId: e.pointerId, from: at, timing, timer: setTimeout(confirmQuiet, timing.holdMs) };
  };

  /** A move of the quiet finger confirms the stroke once it is a drag, as a waiting press reads it. */
  const quietMove = (e: PointerEvent, at: Point): void => {
    const q = press.quiet;
    if (!q || e.pointerId !== q.pointerId) return;
    const facts = { heldMs: 0, dx: at.x - q.from.x, dy: at.y - q.from.y, pointers: Math.max(1, touch.fingers), released: false, timing: q.timing };
    if (resolvePending(facts) === 'drag') confirmQuiet();
  };

  /** The machine's hold timer is the press's clock: it has been held the hold time once the timer
   *  ran out. A pen is one pointer; fingers are the touch tracker's count. */
  const pendingFacts = (p: PendingPress, released: boolean): PendingFacts => ({
    heldMs: p.held ? p.timing.holdMs : 0, dx: p.dx, dy: p.dy, pointers: Math.max(1, touch.fingers),
    released, timing: p.timing,
  });

  /** The plan was resolved for another tool or item: a second finger on a tool tile or a shelf
   *  card changed it while this press waited. */
  const pendingStale = (p: PendingPress): boolean => !sameArming(p.arming, armingNow());

  /** A second finger landed (or the touch was cancelled) while a touch stroke was live: the tool
   *  cancels its press and rolls back what it committed, since the finger meant to navigate. */
  const cancelTouchStroke = () => {
    endQuiet();
    region.cancel();
    if (!press.toolDown) return;
    press.toolDown = false;
    tools()?.handlePointerCancel();
    view()?.overlay.clearGhost();
  };

  /** A second finger landed: cancel whatever the first finger started (stroke, drag, region
   *  brush), since the gesture is navigation from here. */
  const abandonForNavigation = () => {
    press.lastTap = null;
    hideLoupe();
    endPending();
    press.previewing = null;
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
        // A finger's stroke says nothing until a second finger can no longer make it a pan.
        tools()?.handlePointerDown(at.x, at.y, e.timeStamp, timingFor(e).dragThreshold, e.pointerType === 'touch');
        if (e.pointerType === 'touch') beginQuiet(e, at);
        magnifyStroke(e, at);
        return;
      case 'select':
        store.setSelection([intent.block], intent.pick ? { pick: intent.pick } : undefined);
        return;
      case 'pick-cell':
        store.pickCell(intent.cell);
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
      case 'toggle-on-release':
        press.toggleOnUp = intent.block;
        return;
      case 'move-selection':
        drag.arm(intent.anchorId, at.x, at.y, f.macro, { dragThreshold: timingFor(e).dragThreshold });
        return;
      case 'copy-selection':
        drag.arm(intent.anchorId, at.x, at.y, f.macro, { dragThreshold: timingFor(e).dragThreshold, copy: true });
        return;
      case 'band-select':
        band.arm(intent.from, at.x, at.y, timingFor(e).dragThreshold);
        // Neither the armed item's placement preview nor a brush's paint preview has anything
        // left to show: this gesture selects.
        view()?.overlay.clearGhost();
        return;
      case 'context-menu':
        store.setContextMenu({ x: at.x, y: at.y, target: intent.block, mode: modalityOf(e) });
        return;
      case 'cancel-pending': {
        const mgr = tools();
        const t = mgr?.getActiveTool();
        const c = mgr?.getContext();
        if (t && c) t.cancelPending?.(c);
        return;
      }
      case 'zoom-in':
        view()?.camera.zoomStep(1, at.x, at.y);
        return;
      case 'preview-placement':
        // From here the press is a carry of the armed item: this point and the moves that follow
        // are the tool's hovers over this map, which draw its ghost under the finger.
        press.previewing = { pointerId: e.pointerId, arming: armingNow() };
        previewAt(e);
        return;
    }
  };

  /** The hold timer ran out on `p`: the hold arm runs, and a press that opened something is spent. */
  const holdPendingNow = (p: PendingPress): void => {
    if (press.pending !== p) return;
    if (pendingStale(p)) { endPending(); return; }
    p.held = true;
    press.lastTap = null;
    if (resolvePending(pendingFacts(p, false)) !== 'hold') return;
    const hold = p.plan.onHold ?? [];
    if (hold.length === 0) return;
    endPending();
    for (const i of hold) runIntent(i, p.down, p.from, p.facts);
  };

  const holdPending = thenSyncHold(holdPendingNow);

  const beginPending = (e: PointerEvent, at: Point, plan: PressPlan, f: PressFacts): void => {
    endPending();
    const timing = timingFor(e);
    const p: PendingPress = {
      pointerId: e.pointerId, down: e, plan, facts: f, from: at, dx: 0, dy: 0, last: at, timing,
      arming: armingNow(), held: false,
      timer: setTimeout(() => holdPending(p), timing.holdMs),
      // A hold that opens a menu fills a ring around the finger until it does.
      ring: plan.onHold?.some((i) => i.kind === 'context-menu') ? showHoldPress(at) : null,
    };
    press.pending = p;
  };

  /** A move of the waiting pointer. Inside the slop it is swallowed; past it the drag arm runs from
   *  the landing point and the move goes on down the chain to the gesture that arm started. */
  const pendingMove = (e: PointerEvent, at: Point): boolean => {
    const p = press.pending;
    if (!p || e.pointerId !== p.pointerId) return false;
    if (pendingStale(p)) {
      endPending();
      touch.move(e, false); // a two-finger tap's slop check still hears the travel
      return true;
    }
    p.dx = at.x - p.from.x;
    p.dy = at.y - p.from.y;
    if (resolvePending(pendingFacts(p, false)) !== 'drag') {
      touch.move(e, false); // keeps the pinch baseline fresh for a second finger
      p.last = at;
      return true;
    }
    endPending();
    press.lastTap = null;
    for (const i of p.plan.onDrag) runIntent(i, e, p.from, p.facts);
    if (press.previewing) {
      touch.move(e, false); // the preview arm already showed this move; the tracker still hears it
      return true;
    }
    // A finger pans by the tracker's deltas, which start at the last swallowed move: the travel
    // inside the slop is applied here, so the map stays under the finger from the landing point.
    if (press.leftPanning && e.pointerType === 'touch') {
      gestures.touch({ panX: p.from.x - p.last.x, panY: p.from.y - p.last.y, scale: 1, twist: 0, midX: p.last.x, midY: p.last.y });
    }
    return false;
  };

  /** A tap releasing at `at` is the second of a double tap after `prev`: it landed inside the window
   *  from the first one's release, and lifted inside the first one's slop. */
  const followsTap = (prev: NonNullable<PressState['lastTap']>, p: PendingPress, at: Point): boolean =>
    p.down.timeStamp - prev.time <= p.timing.doubleTapMs
      && !travelledPast(at.x - prev.at.x, at.y - prev.at.y, p.timing.doubleTapSlop);

  /** The waiting pointer lifted: a tap runs the tap arm here, as a press and release, or the
   *  double-tap arm with the selection the first tap found; a press that was held, or that
   *  travelled with no move to show it, ends with nothing. */
  const pendingRelease = (e: PointerEvent, at: Point): boolean => {
    const p = press.pending;
    if (!p || e.pointerId !== p.pointerId) return false;
    endPending();
    const prev = press.lastTap;
    press.lastTap = null;
    if (pendingStale(p)) return true;
    p.dx = at.x - p.from.x;
    p.dy = at.y - p.from.y;
    if (p.held || resolvePending(pendingFacts(p, true)) !== 'tap') return true;
    const double = p.plan.onDoubleTap;
    if (double && prev && followsTap(prev, p, at)) {
      // The second tap gives back what the first changed, which leaves the first's undo step spent.
      useEditorStore.getState().setSelection([...prev.selection], { record: false });
      for (const i of double) runIntent(i, e, at, p.facts);
      releasePrimary(e, at);
      return true;
    }
    if (double) press.lastTap = { at, time: e.timeStamp, selection: useEditorStore.getState().selection };
    for (const i of p.plan.onTap) runIntent(i, e, at, p.facts);
    settleTap();
    releasePrimary(e, at);
    return true;
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
    const f = buildPressFacts(PRIMARY_BUTTON, e.pointerType, at.x, at.y);
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
    if (plan.pending) { beginPending(e, at, plan, f); return; }
    press.lastTap = null;
    runPlan(plan, e, at, f);
  };

  const onPointerDownNow = (e: PointerEvent) => {
    if (!isCanvasTarget(e)) return;
    releaseTextFocus(container);
    const at = clientPoint(e);

    // A finger has no meaningful "position" once it lifts, so it never feeds the resampler.
    if (pointerHovers(e)) remember(at, e.pointerType);

    if (touch.down(e, abandonForNavigation)) return;
    // Right or middle press: arm camera navigation. A tap opens the context menu on release.
    if (gestures.navDown(e)) return;
    leftDown(e, at);
  };

  const onPointerDown = thenSyncHold(onPointerDownNow);

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

  const onPointerMoveNow = (e: PointerEvent) => {
    if (isCarried(e.pointerId)) return; // the carry hands this pointer's moves to `carryTarget`
    const at = clientPoint(e);
    // "Here" means either this container is literally under the pointer, or a stroke already
    // started on it (a mid-stroke drag stays live even if the browser occasionally reports a target
    // outside the element, the same condition the tool feed below uses).
    if (pointerHovers(e) && (press.toolDown || isCanvasTarget(e))) remember(at, e.pointerType);
    if (pendingMove(e, at)) return;
    if (previewMove(e)) return;
    quietMove(e, at);
    if (panMove(e)) return;
    if (touch.move(e, press.leftPanning)) return;
    // Right or middle drag: orbit the camera where the view has one, otherwise pan.
    if (gestures.navMove(e)) return;
    if (band.move(at.x, at.y)) return;
    if (region.move(at.x, at.y)) return;
    if (drag.move(at.x, at.y)) return;
    if (region.hover(at.x, at.y, isCanvasTarget(e) && pointerHovers(e))) return;
    if (press.toolDown && press.loupe === e.pointerId) showLoupe(e, at);
    if (!drag.dragging && (press.toolDown || isCanvasTarget(e))) feedTools(e, at);
    // Idle mouse hover: preview what a click would select as a grey box.
    if (!press.toolDown && !drag.dragging) hover.update(e);
  };

  const onPointerMove = thenSyncHold(onPointerMoveNow);

  /** The Ctrl band's release. A tool-owned select state runs its own press under the band (the
   *  plan pairs them), so that stroke closes here first. */
  const releaseBand = (e: PointerEvent, at: Point): boolean => {
    if (!band.armed) return false;
    if (press.toolDown) {
      press.toolDown = false;
      endQuiet();
      tools()?.handlePointerUp(at.x, at.y, e.timeStamp, timingFor(e).doubleTapMs);
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
      const f = buildPressFacts(e.button, e.pointerType, at.x, at.y);
      if (f) for (const intent of resolveNavTap(f)) runIntent(intent, e, at, f);
    }
    return true;
  };

  /** The region brush's release. */
  const releaseRegion = (e: PointerEvent): boolean => {
    if (!region.release(e.timeStamp, timingFor(e).doubleTapMs)) return false;
    if (!pointerHovers(e)) view()?.overlay.clearGhost();
    else resamplePointer();
    return true;
  };

  /** A tap (no drag) on a member of a group selects that member alone: an unmodified click always
   *  ends with one thing selected. On a lone selected block it toggles the selection off. */
  const settleTap = (): void => {
    if (drag.dragging) return;
    drag.cancel();
    if (press.toggleOnUp) {
      useEditorStore.getState().toggleSelection(press.toggleOnUp);
      press.toggleOnUp = null;
    } else if (press.collapseToOnUp) {
      useEditorStore.getState().setSelection([{ kind: 'object', id: press.collapseToOnUp }]);
      press.collapseToOnUp = null;
    } else if (press.toggleOffOnUp) {
      useEditorStore.getState().clearSelection();
      press.toggleOffOnUp = false;
    }
  };

  /** The previewing pointer moved: over this map the tool hovers there, anywhere else (the object
   *  bar, a panel) the preview leaves the map. */
  const previewAt = (e: PointerEvent): void => {
    if (carryTarget.over(e.clientX, e.clientY)) carryTarget.hover(e);
    else carryTarget.leave();
  };

  /** A move of the previewing pointer. The pinch tracker hears it too, so a second finger landing
   *  later pinches from where this one is. Under a changed arming the preview has nothing left to
   *  show, and stays only so its release places nothing. */
  const previewMove = (e: PointerEvent): boolean => {
    const preview = press.previewing;
    if (!preview || preview.pointerId !== e.pointerId) return false;
    touch.move(e, false);
    if (sameArming(preview.arming, armingNow())) previewAt(e);
    else carryTarget.leave();
    return true;
  };

  /** The previewing pointer lifted: the item lands where it lifts and the map settles, through the
   *  carry's own drop and settle, so a release off this map places nothing and a refused cell
   *  refuses as a click there would. An arming changed under the preview places nothing either. */
  const releasePreview = (e: PointerEvent): boolean => {
    const preview = press.previewing;
    if (!preview || preview.pointerId !== e.pointerId) return false;
    press.previewing = null;
    if (sameArming(preview.arming, armingNow())) dropAt(carryTarget, e);
    carryTarget.settle(e);
    return true;
  };

  /** The primary button's own release: the pan ends, a preview lands, and an open stroke closes. */
  const releasePrimary = (e: PointerEvent, at: Point): void => {
    if (e.button !== PRIMARY_BUTTON) return;
    press.leftPanning = false;
    gestures.navUp();
    setCursorDrag('none');
    if (press.panKeyPanning) { press.panKeyPanning = false; return; }
    if (releasePreview(e)) return;
    if (!press.toolDown) return;
    press.toolDown = false;
    endQuiet();
    tools()?.handlePointerUp(at.x, at.y, e.timeStamp, timingFor(e).doubleTapMs);
    if (!pointerHovers(e)) view()?.overlay.clearGhost();
    else resamplePointer();
  };

  /** A release goes to the first gesture that owns it, in this order: touch navigation, a waiting
   *  press, the band, a nav button, the region brush, an object drop; anything else settles a tap
   *  and releases the primary button. */
  const onPointerUpNow = (e: PointerEvent) => {
    if (isCarried(e.pointerId)) return;
    // The loupe follows its finger's press, whichever gesture below claims the release.
    if (press.loupe === e.pointerId) hideLoupe();
    if (touch.up(e)) return; // navigation fingers never reach the tool/select paths
    const at = clientPoint(e);
    if (pendingRelease(e, at)) return;
    if (releaseBand(e, at) || releaseNav(e, at) || releaseRegion(e)) return;
    if (drag.dragging && drag.objectId) {
      forgetTap();
      drag.drop(at.x, at.y);
      // The move latch arms one move, which this drop was.
      const store = useEditorStore.getState();
      if (store.moveLatched) store.setMoveLatched(false);
      return;
    }
    settleTap();
    releasePrimary(e, at);
  };

  const onPointerUp = thenSyncHold(onPointerUpNow);

  /** Ends the press with nothing committed: whatever it started (stroke, drag, preview, band,
   *  region brush, pan) is dropped and the tool rolls back what it laid. `cancelled` is the browser's
   *  cancel of a touch, which the pinch tracker hears too; without one the press is taken back from
   *  outside (`state/edits-in-flight.ts`), and its later moves and release find nothing to continue. */
  const abortPress = (cancelled?: PointerEvent) => {
    press.lastTap = null;
    hideLoupe();
    endPending();
    press.previewing = null;
    press.leftPanning = false;
    press.panKeyPanning = false;
    cancelTouchStroke();
    if (cancelled?.pointerType === 'touch') touch.cancelled(cancelled);
    gestures.cancel();
    drag.cancel();
    forgetTap();
    setCursorDrag('none');
    region.cancel();
    band.cancel();
    view()?.overlay.clearGhost();
    syncMapHold();
  };

  // The browser cancels touches (incoming call, edge swipe, palm rejection): abort any live
  // stroke like a pinch would, and drop every in-flight gesture state without committing.
  const onPointerCancel = (e: PointerEvent) => abortPress(e);

  const onContextMenu = (e: MouseEvent) => {
    if (isCanvasTarget(e)) e.preventDefault();
  };

  // The non-primary click that follows a middle/right press. Suppressed for the same reason the
  // context menu is: those buttons drive the camera here. It has no effect on a browser-level
  // gesture handler (nothing a page does can), which is what `onGestureLost` is for.
  const onAuxClick = (e: MouseEvent) => {
    if (isNavButton(e.button) && isCanvasTarget(e)) e.preventDefault();
  };

  // A nav drag still armed when focus leaves never got its release, and a waiting press never will.
  // The loupe goes with the focus, but its press lives on: the next move shows it again.
  const onWindowBlur = () => {
    if (press.loupe !== null) view()?.hideLoupe();
    endPending();
    gestures.windowBlurred();
  };

  // A tool fed by a re-sample writes the store (a notes drag sets its draft or moves its note on
  // every move), which is itself a re-sample trigger; without the latch the two feed each other
  // until the stack overflows, and the overflow cuts the store's later listeners off that write.
  let resampling = false;
  /**
   * Re-feeds the last known screen position to the tools and hover when something other than a
   * pointer event changed what it means: the camera moving under a still cursor, or the armed
   * item's rotation changing. Otherwise a live stroke freezes on stale cells and the hover box or
   * ghost tracks a cell a click would no longer hit. Skipped while a gesture owns the pointer
   * through its own move handling (a waiting touch press, orbit or pan, an object drag, the band,
   * the region brush, a pinch), which the tools must not hear mid-gesture. Every camera move a
   * gesture makes happens under one of those flags, so a re-sample never feeds the
   * 'viewport-changed' it answers.
   */
  function resamplePointer(): void {
    if (press.pending || !pointer.known || resampling) return;
    // A pen preview under a changed arming shows nothing until it lifts.
    if (press.previewing && !sameArming(press.previewing.arming, armingNow())) return;
    if (gestures.isNavigating() || press.leftPanning || press.panKeyPanning || drag.dragging || band.armed || region.painting || touch.navigating) return;
    resampling = true;
    try {
      if (region.hover(pointer.x, pointer.y, true)) return;
      tools()?.handlePointerMove(pointer.x, pointer.y);
      // Brushes/eraser/placer already got their re-sample above; the hover box and cursor hints are
      // the "no stroke active" half of the same fact, gated (inside the hover probe) on the hovered
      // cell actually changing, same as a real drag.
      if (!press.toolDown) {
        hover.update({ clientX: pointer.x, clientY: pointer.y, pointerType: pointer.pointerType, target: container });
      }
    } finally {
      resampling = false;
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

  /**
   * An entry carried from a list (`carry.ts`): the pointer stays captured by the entry, so this
   * canvas is found by hit testing the native point. Over it, the carry is an idle hover of the
   * active tool, and the release one press and release of it, the click a placement would be.
   */
  const carryTarget: CarryTarget = {
    over(clientX, clientY) {
      const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(clientX, clientY) : null;
      return !!hit && container.contains(hit);
    },
    hover(e) {
      const at = clientPoint(e);
      if (pointerHovers(e)) remember(at, e.pointerType);
      tools()?.handlePointerMove(at.x, at.y, e.timeStamp);
      hover.update({ clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType, target: container });
      showLoupe(e, at);
      // A drop always reaches the tool: it never selects what it lands on instead.
      setCursorPressSelects(false);
    },
    leave() {
      hideLoupe();
      view()?.overlay.clearGhost();
      view()?.overlay.clearHover();
      hover.forget();
      pointer.known = false;
      clearCursorFacts();
    },
    drop(e) {
      const at = clientPoint(e);
      view()?.overlay.clearHover();
      const store = useEditorStore.getState();
      store.setContextMenu(null);
      store.setDeletePopover(null);
      tools()?.handlePointerDown(at.x, at.y, e.timeStamp, timingFor(e).dragThreshold);
      tools()?.handlePointerUp(at.x, at.y, e.timeStamp, timingFor(e).doubleTapMs);
    },
    settle(e) {
      hideLoupe();
      hover.forget();
      if (!pointerHovers(e)) { view()?.overlay.clearGhost(); return; }
      remember(clientPoint(e), e.pointerType);
      resamplePointer();
    },
  };
  const releaseCarryTarget = registerCarryTarget(carryTarget);

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
    hideLoupe();
    endPending();
    endQuiet();
    mapHold?.();
    mapHold = null;
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
    releaseCarryTarget();
  };
}
