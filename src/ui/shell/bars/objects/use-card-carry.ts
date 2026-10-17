/*
 * The press that carries an item card onto the map. `resolveListPress` decides whether a held press
 * is a carry, still a possible tap, or a finger scrolling the row; a tap stays the card's own click.
 * Once lifted, the card keeps the pointer captured and hands every move and the release to the carry
 * (`editor/editing/object-shelf.ts:carryItem`), which owns what it arms and puts back.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { carryItem } from '../../../../editor/editing/object-shelf';
import type { Carry } from '../../../../view/interaction/pointer/carry';
import { LIST_HOLD_MS, resolveListPress } from '../../../../view/interaction/press/list-press';
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
}

export interface CardCarry {
  /** The card is in the hand. */
  lifted: boolean;
  /** Whether the click now arriving ends a carry or a scroll rather than being a tap; the card
   *  skips its toggle when it does. */
  takesClick: () => boolean;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
    onLostPointerCapture: () => void;
    onContextMenu: (e: { preventDefault: () => void }) => void;
  };
}

/** `enabled` false leaves the card a plain button; `onLift` runs as the card leaves the row. */
export function useCardCarry(
  itemId: string, ref: RefObject<HTMLElement | null>, { enabled, onLift }: { enabled: boolean; onLift: () => void },
): CardCarry {
  const [lifted, setLifted] = useState(false);
  const held = useRef<Held | null>(null);
  const carry = useRef<Carry | null>(null);
  /** The press that is ending was a carry or a scroll, so the click it completes is not a tap. */
  const notTap = useRef(false);

  const forget = useCallback((): void => {
    if (held.current) clearTimeout(held.current.timer);
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
      onEnd: () => { carry.current = null; setLifted(false); },
    });
    if (!c) return null;
    carry.current = c;
    // A finger is captured where it landed already; a mouse is captured from its press.
    if (el?.isConnected) el.setPointerCapture?.(h.pointerId);
    setLifted(true);
    onLift();
    return c;
  }, [forget, itemId, onLift, ref]);

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
  // passive may refuse them, which React's touch props are not.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hold = (e: TouchEvent) => { if (carry.current && e.cancelable) e.preventDefault(); };
    el.addEventListener('touchmove', hold, { passive: false });
    return () => el.removeEventListener('touchmove', hold);
  }, [ref]);

  // A card leaving the row mid-carry (the category changed under it) puts the item back.
  useEffect(() => () => { forget(); carry.current?.cancel(); }, [forget]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    notTap.current = false;
    if (!enabled || e.button !== PRIMARY_BUTTON || carry.current) return;
    forget();
    const { pointerId, pointerType, clientX: x, clientY: y } = e.nativeEvent;
    if (pointerType !== 'touch') e.currentTarget.setPointerCapture?.(pointerId);
    const at = performance.now();
    held.current = {
      pointerId, pointerType, x, y, dx: 0, dy: 0, at,
      // A coarsened clock can run the timer a fraction of a millisecond before the hold is due.
      timer: setTimeout(() => decide(Math.max(performance.now(), at + LIST_HOLD_MS)), LIST_HOLD_MS),
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

  const onPointerCancel = (): void => {
    forget();
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
      // The capture went somewhere else without a release reaching the card.
      onLostPointerCapture: () => { if (carry.current) onPointerCancel(); },
      // A long press would open the platform's menu over the card it is lifting.
      onContextMenu: (e) => { if (held.current || carry.current) e.preventDefault(); },
    },
  };
}
