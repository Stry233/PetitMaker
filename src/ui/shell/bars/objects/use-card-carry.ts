/*
 * The press that carries an item card onto the map. `resolveListPress` decides whether a held press
 * is a carry, still a possible tap, or a finger scrolling the row; a tap stays the card's own click.
 * Once lifted, the card holds the pointer captured and hands every move and the release to the carry
 * (`editor/editing/object-shelf.ts:carryItem`), which owns what it arms and puts back. A browser that
 * takes a lifted finger's pointer stream anyway (a pointercancel while the card holds it) still sends
 * that finger's touch events to the card, which carry on in its place. While a finger or pen holds
 * the card still, the hold ring fills above it and goes the moment the press lifts the card, scrolls
 * or ends.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { carryItem } from '../../../../editor/editing/object-shelf';
import type { Carry, CarrySample } from '../../../../view/interaction/pointer/carry';
import { resolveListPress } from '../../../../view/interaction/press/list-press';
import { modalityOf, timingFor } from '../../../../platform/input/gesture-timing';
import { clearHoldPress, showHoldPress } from '../../../../view/interaction/pointer/gesture-channel';
import { clientPoint } from '../../../../platform/device/viewport-space';
import { PRIMARY_BUTTON } from '../../../../view/interaction/press/pointer-buttons';

/** A press not yet decided. Coordinates are native, as the carry's are. */
interface Held {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** `performance.now()` time of the press, the clock event time stamps share. */
  at: number;
  timer: ReturnType<typeof setTimeout>;
  /** The hold ring this press shows (`gesture-channel.ts:showHoldPress`); null for a mouse. */
  ring: number | null;
}

/** One changed touch of a touch event, as a carry sample of `pointerId`; null when `id` is not among them. */
function touchSample(e: TouchEvent, id: number, pointerId: number): CarrySample | null {
  const t = Array.from(e.changedTouches).find((c) => c.identifier === id);
  return t ? { pointerId, pointerType: 'touch', clientX: t.clientX, clientY: t.clientY, timeStamp: e.timeStamp } : null;
}

interface CardCarry {
  /** The card is in the hand. */
  lifted: boolean;
  /** Whether the click now arriving ends a carry or a scroll rather than being a tap; the card
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

/** `enabled` false leaves the card a plain button; `onLift` runs as the card leaves the row and
 *  `onLand` once the carry is over, however it ends. */
export function useCardCarry(
  itemId: string, ref: RefObject<HTMLElement | null>,
  { enabled, onLift, onLand }: { enabled: boolean; onLift: () => void; onLand?: () => void },
): CardCarry {
  const [lifted, setLifted] = useState(false);
  const held = useRef<Held | null>(null);
  const carry = useRef<Carry | null>(null);
  /** The pointer the carry follows. */
  const carrier = useRef(0);
  /** The touch identifier of the finger pressing the card, from its touchstart. */
  const touchId = useRef<number | null>(null);
  /** The browser took the carrying finger's pointer stream; its touch events drive the carry now. */
  const byTouch = useRef(false);
  /** The press that is ending was a carry or a scroll, so the click it completes is not a tap. */
  const notTap = useRef(false);

  const forget = useCallback((): void => {
    const h = held.current;
    if (h) {
      clearTimeout(h.timer);
      if (h.ring !== null) clearHoldPress(h.ring);
    }
    held.current = null;
  }, []);

  const lift = useCallback((): Carry | null => {
    const h = held.current;
    forget();
    if (!h) return null;
    notTap.current = true;
    const el = ref.current;
    const c = carryItem(itemId, {
      pointerId: h.pointerId,
      surface: el,
      onEnd: () => { carry.current = null; byTouch.current = false; setLifted(false); onLand?.(); },
      picksOnReturn: modalityOf({ pointerType: h.pointerType }) === 'touch',
    });
    if (!c) return null;
    carry.current = c;
    carrier.current = h.pointerId;
    // The card claims the finger at the hold, so the carry hears it wherever it goes; a mouse is
    // captured from its press already.
    if (el?.isConnected) el.setPointerCapture?.(h.pointerId);
    setLifted(true);
    onLift();
    return c;
  }, [forget, itemId, onLift, onLand, ref]);

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
  // anyway, the touch events still reaching the card carry on where the pointer stream stopped.
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

  // A card leaving the row mid-carry (the category changed under it) puts the item back.
  useEffect(() => () => { forget(); carry.current?.cancel(); }, [forget]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    notTap.current = false;
    if (!enabled || e.button !== PRIMARY_BUTTON || carry.current) return;
    const { pointerId, pointerType, clientX: x, clientY: y } = e.nativeEvent;
    // A second finger on the card while the first is held leaves the first press to decide.
    if (pointerType === 'touch' && held.current?.pointerType === 'touch' && held.current.pointerId !== pointerId) return;
    forget();
    touchId.current = null;
    if (pointerType !== 'touch') e.currentTarget.setPointerCapture?.(pointerId);
    const at = performance.now();
    const { holdMs } = timingFor({ pointerType });
    held.current = {
      pointerId, pointerType, x, y, dx: 0, dy: 0, at,
      // A coarsened clock can run the timer a fraction of a millisecond before the hold is due.
      timer: setTimeout(() => decide(Math.max(performance.now(), at + holdMs)), holdMs),
      // A finger or pen fills a ring above itself until the card lifts; a mouse press shows none.
      ring: modalityOf({ pointerType }) === 'touch' ? showHoldPress(clientPoint(e), 'control') : null,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const native = e.nativeEvent;
    if (carry.current) { carry.current.move(native); return; }
    const h = held.current;
    if (!h || native.pointerId !== h.pointerId) return;
    h.dx = native.clientX - h.x;
    h.dy = native.clientY - h.y;
    // The move that lifts the card is its first carried move too.
    decide(performance.now())?.move(native);
  };

  /** The click a release completes arrives in the same task, so the answer stands only until the
   *  next one: a keyboard press of the card later is a tap again. */
  const settleClick = (): void => { if (notTap.current) setTimeout(() => { notTap.current = false; }, 0); };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    forget();
    carry.current?.release(e.nativeEvent);
    settleClick();
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLElement>): void => {
    forget();
    const { pointerId, pointerType } = e.nativeEvent;
    // The browser took a lifted finger the card holds: the carry follows that finger's touches.
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
      // The capture went somewhere else without a release reaching the card: a held press (a pen's,
      // captured from its press) ends with its ring, and a carry puts the card back.
      onLostPointerCapture: () => {
        if (byTouch.current) return;
        forget();
        if (!carry.current) return;
        carry.current.cancel();
        settleClick();
      },
      // A long press would open the platform's menu over the card it is lifting.
      onContextMenu: (e) => { if (held.current || carry.current) e.preventDefault(); },
    },
  };
}
