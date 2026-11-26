/*
 * The press that carries a list entry (a shelf card, a blueprint card or row) off its list.
 * `resolveListPress` decides whether a held press is a carry, still a possible tap, or a finger
 * scrolling the list; a tap stays the entry's own click. Once lifted, the entry holds the pointer
 * captured and hands every move and the release to the carry its caller starts (`lift`), which owns
 * what it arms and puts back. A browser that takes a lifted finger's pointer stream anyway (a
 * pointercancel while the entry holds it) still sends that finger's touch events to the entry, which
 * carry on in its place. While a finger or pen holds the entry still, the hold ring fills above it and
 * goes the moment the press lifts the entry, scrolls or ends. `useHoldMenu` holds an entry's own menu
 * the same way.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Carry, CarrySample } from '../../../view/interaction/pointer/carry';
import { resolveListPress } from '../../../view/interaction/press/list-press';
import { modalityOf, timingFor, travelledPast } from '../../../platform/input/gesture-timing';
import { clearHoldPress, showHoldPress } from '../../../view/interaction/pointer/gesture-channel';
import { clientPoint } from '../../../platform/device/viewport-space';
import { PRIMARY_BUTTON } from '../../../view/interaction/press/pointer-buttons';
import { heldClickCapture } from '../../primitives/use-reveal';

/** A press being held: what runs once it is held long enough, and the hold ring it shows
 *  (`gesture-channel.ts:showHoldPress`), null for a mouse. */
interface HoldTimer {
  timer: ReturnType<typeof setTimeout>;
  ring: number | null;
}

/** Starts the hold of the press `e`: `due` runs once it has been held its pointer's hold time, and a
 *  finger or pen fills the ring above itself until then; a mouse press shows none. */
function startHold(e: ReactPointerEvent<HTMLElement>, due: () => void): HoldTimer {
  return {
    timer: setTimeout(due, timingFor(e.nativeEvent).holdMs),
    ring: modalityOf(e.nativeEvent) === 'touch' ? showHoldPress(clientPoint(e), 'control') : null,
  };
}

/** Lets a hold go with its ring, before or as it is due. */
function endHold(hold: HoldTimer | null): void {
  if (!hold) return;
  clearTimeout(hold.timer);
  if (hold.ring !== null) clearHoldPress(hold.ring);
}

/** A press not yet decided. Coordinates are native, as the carry's are. */
interface Held extends HoldTimer {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** `performance.now()` time of the press, the clock event time stamps share. */
  at: number;
}

/** One changed touch of a touch event, as a carry sample of `pointerId`; null when `id` is not among them. */
function touchSample(e: TouchEvent, id: number, pointerId: number): CarrySample | null {
  const t = Array.from(e.changedTouches).find((c) => c.identifier === id);
  return t ? { pointerId, pointerType: 'touch', clientX: t.clientX, clientY: t.clientY, timeStamp: e.timeStamp } : null;
}

/** What a carry starts from: the pointer it follows, the entry holding it, and what to run once the
 *  carry is over, however it ends. */
export interface CarryHold {
  pointerId: number;
  pointerType: string;
  surface: HTMLElement | null;
  onEnd: () => void;
}

export interface ListCarry {
  /** The entry is in the hand. */
  lifted: boolean;
  /** Whether the click now arriving ends a carry or a scroll rather than being a tap; the entry
   *  skips its toggle when it does. */
  takesClick: () => boolean;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onLostPointerCapture: () => void;
    onContextMenu: (e: { preventDefault: () => void }) => void;
  };
}

/** `enabled` false leaves the entry a plain button; `lift` starts the carry, or null when it cannot;
 *  `onLift` runs as the entry leaves the list and `onLand` once the carry is over, however it ends. */
export function useListCarry(
  ref: RefObject<HTMLElement | null>,
  { enabled, lift: start, onLift, onLand }: {
    enabled: boolean; lift: (hold: CarryHold) => Carry | null; onLift?: () => void; onLand?: () => void;
  },
): ListCarry {
  const [lifted, setLifted] = useState(false);
  const held = useRef<Held | null>(null);
  const carry = useRef<Carry | null>(null);
  /** The pointer the carry follows. */
  const carrier = useRef(0);
  /** The touch identifier of the finger pressing the entry, from its touchstart. */
  const touchId = useRef<number | null>(null);
  /** The browser took the carrying finger's pointer stream; its touch events drive the carry now. */
  const byTouch = useRef(false);
  /** The press that is ending was a carry or a scroll, so the click it completes is not a tap. */
  const notTap = useRef(false);

  const forget = useCallback((): void => {
    endHold(held.current);
    held.current = null;
  }, []);

  const lift = useCallback((): Carry | null => {
    const h = held.current;
    forget();
    if (!h) return null;
    notTap.current = true;
    const el = ref.current;
    const c = start({
      pointerId: h.pointerId,
      pointerType: h.pointerType,
      surface: el,
      onEnd: () => { carry.current = null; byTouch.current = false; setLifted(false); onLand?.(); },
    });
    if (!c) return null;
    carry.current = c;
    carrier.current = h.pointerId;
    // The entry claims the finger at the hold, so the carry hears it wherever it goes; a mouse is
    // captured from its press already.
    if (el?.isConnected) el.setPointerCapture?.(h.pointerId);
    setLifted(true);
    onLift?.();
    return c;
  }, [forget, start, onLift, onLand, ref]);

  /** Resolves the held press at `now`; the carry when it became one. */
  const decide = useCallback((now: number): Carry | null => {
    const h = held.current;
    if (!h) return null;
    const outcome = resolveListPress({ pointerType: h.pointerType, heldMs: now - h.at, dx: h.dx, dy: h.dy });
    if (outcome === 'carry') return lift();
    if (outcome === 'scroll') { notTap.current = true; forget(); }
    return null;
  }, [forget, lift]);

  // While carried, a finger's moves must not scroll the row or the page: only a listener that is not
  // passive may refuse them, which React's touch props are not. Refusing the first move past the slop
  // after the lift keeps the browser from starting its pan, so no pointercancel comes. Should one come
  // anyway, the touch events still reaching the entry carry on where the pointer stream stopped.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = (e: TouchEvent) => {
      const h = held.current;
      if (h?.pointerType !== 'touch' || touchId.current !== null) return;
      const nearest = Array.from(e.changedTouches)
        .sort((a, b) => Math.hypot(a.clientX - h.x, a.clientY - h.y) - Math.hypot(b.clientX - h.x, b.clientY - h.y))[0];
      if (nearest) touchId.current = nearest.identifier;
    };
    const sample = (e: TouchEvent) => (byTouch.current && touchId.current !== null ? touchSample(e, touchId.current, carrier.current) : null);
    const move = (e: TouchEvent) => {
      if (carry.current && e.cancelable) e.preventDefault();
      const at = sample(e);
      if (at) carry.current?.move(at);
    };
    const end = (e: TouchEvent) => {
      const at = sample(e);
      if (!at) return;
      if (e.type === 'touchend') carry.current?.release(at);
      else carry.current?.cancel();
      // A cancelled pointer stream completes no click.
      notTap.current = false;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [ref]);

  // An entry leaving its list mid-carry (the category changed under it) puts what it carries back.
  useEffect(() => () => { forget(); carry.current?.cancel(); }, [forget]);

  // Moving an element within the document lets go of the pointer it captured, so a lifted entry its
  // list re-orders (a sort dropped under the carry) takes it back in that commit, before the next event.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!carry.current || byTouch.current || !el?.isConnected) return;
    try {
      el.setPointerCapture?.(carrier.current);
    } catch {
      // Thrown for a pointer that is no longer down; its release or cancel ends the carry.
    }
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    notTap.current = false;
    if (!enabled || e.button !== PRIMARY_BUTTON || carry.current) return;
    const { pointerId, pointerType, clientX: x, clientY: y } = e.nativeEvent;
    // A second finger on the entry while the first is held leaves the first press to decide.
    if (pointerType === 'touch' && held.current?.pointerType === 'touch' && held.current.pointerId !== pointerId) return;
    forget();
    touchId.current = null;
    if (pointerType !== 'touch') e.currentTarget.setPointerCapture?.(pointerId);
    const at = performance.now();
    const { holdMs } = timingFor({ pointerType });
    held.current = {
      pointerId, pointerType, x, y, dx: 0, dy: 0, at,
      // A coarsened clock can run the timer a fraction of a millisecond before the hold is due.
      ...startHold(e, () => decide(Math.max(performance.now(), at + holdMs))),
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const native = e.nativeEvent;
    if (carry.current) { carry.current.move(native); return; }
    const h = held.current;
    if (!h || native.pointerId !== h.pointerId) return;
    h.dx = native.clientX - h.x;
    h.dy = native.clientY - h.y;
    // The move that lifts the entry is its first carried move too.
    decide(performance.now())?.move(native);
  };

  /** The click a release completes arrives in the same task, so the answer stands only until the
   *  next one: a keyboard press of the entry later is a tap again. */
  const settleClick = (): void => { if (notTap.current) setTimeout(() => { notTap.current = false; }, 0); };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    forget();
    carry.current?.release(e.nativeEvent);
    settleClick();
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>): void => {
    forget();
    const { pointerId, pointerType } = e.nativeEvent;
    // The browser took a lifted finger the entry holds: the carry follows that finger's touches.
    if (carry.current && pointerType === 'touch' && touchId.current !== null && ref.current?.hasPointerCapture?.(pointerId)) {
      byTouch.current = true;
      return;
    }
    carry.current?.cancel();
    settleClick();
  };

  return {
    lifted,
    takesClick: () => {
      const taken = notTap.current;
      notTap.current = false;
      return taken;
    },
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      // The capture went somewhere else without a release reaching the entry: a held press (a pen's,
      // captured from its press) ends with its ring, and a carry puts the entry back.
      onLostPointerCapture: () => {
        if (byTouch.current) return;
        forget();
        if (!carry.current) return;
        carry.current.cancel();
        settleClick();
      },
      // A long press would open the platform's menu over the entry it is lifting.
      onContextMenu: (e) => { if (held.current || carry.current) e.preventDefault(); },
    },
  };
}

/** What an entry wears to open its own menu. */
interface HoldMenuBind {
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClickCapture: (e: ReactMouseEvent<Element>) => void;
}

/**
 * An entry's own menu, `open`ed under the entry by a right press or by a finger or pen held still on it
 * for the hold time, the hold ring filling above it meanwhile; a move past the drag threshold or the
 * press ending first lets the hold go. The click ending a hold that opened the menu never reaches the
 * entry, so the entry stays as it was under its menu. A mouse holds nothing: its right press is its
 * menu. One hook serves several entries, one press at a time.
 */
export function useHoldMenu(): (open: (anchor: HTMLElement) => void) => HoldMenuBind {
  const hold = useRef<(HoldTimer & { pointerId: number; x: number; y: number }) | null>(null);
  const opened = useRef(false);
  const drop = useCallback((): void => {
    endHold(hold.current);
    hold.current = null;
  }, []);
  useEffect(() => drop, [drop]);
  const swallow = heldClickCapture(opened);
  return (open) => ({
    onContextMenu: (e) => {
      e.preventDefault();
      // A finger's long press brings the platform's own menu event while it holds.
      if (hold.current) opened.current = true;
      drop();
      open(e.currentTarget);
    },
    onPointerDown: (e) => {
      opened.current = false;
      if (e.pointerType === 'mouse') return;
      drop();
      const el = e.currentTarget;
      hold.current = { pointerId: e.pointerId, ...clientPoint(e), ...startHold(e, () => { drop(); opened.current = true; open(el); }) };
    },
    onPointerMove: (e) => {
      const h = hold.current;
      if (!h || h.pointerId !== e.pointerId) return;
      const p = clientPoint(e);
      if (travelledPast(p.x - h.x, p.y - h.y, timingFor(e).dragThreshold)) drop();
    },
    onPointerUp: drop,
    onPointerCancel: drop,
    onClickCapture: swallow,
  });
}
