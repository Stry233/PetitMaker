/**
 * Information a control keeps until it is reached for: shown while a mouse rests on it in PC mode,
 * while a finger holds it past the touch hold time (`gesture-timing.ts`) in touch mode, where nothing
 * hovers, and on a keyboard's focus in either. The mode is the live one (`design/input-mode.tsx`).
 */
import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { GESTURE_TIMING } from '../../platform/input/gesture-timing';
import { useCurrentInputMode } from '../design/input-mode';

export interface RevealBind {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onFocus: (e: FocusEvent<Element>) => void;
  onBlur: (e: FocusEvent<Element>) => void;
  /** Swallows the click that ends a hold which opened the reveal: that press was a look, not a tap.
   *  Absent where the hold only pauses or highlights (`keepsClick`). */
  onClickCapture?: (e: MouseEvent<Element>) => void;
}

/** The last of enter, leave, focus, blur and the hold decides `shown`. Spread `bind` on the element
 *  that owns the information; a focus that a press causes reveals nothing, since a tap focuses the
 *  control it lands on in some browsers. `keepsClick` lets the click ending a hold land, for a use
 *  that pauses or highlights rather than shows something. `onChange` hears each flip of `shown`.
 *  `touch` is the mode the reveal follows. */
export function useReveal({ keepsClick = false, onChange }: {
  keepsClick?: boolean; onChange?: (shown: boolean) => void;
} = {}): { shown: boolean; bind: RevealBind; touch: boolean } {
  const live = useCurrentInputMode();
  const touch = live === 'touch';
  const holdMs = GESTURE_TIMING[live].holdMs;
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState(touch);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressing = useRef(false);
  const heldOpen = useRef(false);
  const shownNow = useRef(shown);
  shownNow.current = shown;

  // A mode switch lands only once every pointer has lifted, so whatever was shown belongs to the other mode.
  if (mode !== touch) { setMode(touch); setShown(false); }

  const stopHold = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopHold, []);

  const heard = useRef(onChange);
  heard.current = onChange;
  const told = useRef(false);
  useEffect(() => {
    if (shown === told.current) return;
    told.current = shown;
    heard.current?.(shown);
  }, [shown]);

  const release = (): void => {
    pressing.current = false;
    if (!touch) return;
    stopHold();
    setShown(false);
  };

  const bind: RevealBind = {
    onPointerEnter: () => { if (!touch) setShown(true); },
    onPointerLeave: () => { pressing.current = false; stopHold(); setShown(false); },
    onPointerDown: () => {
      pressing.current = true;
      heldOpen.current = false;
      if (!touch) return;
      stopHold();
      timer.current = setTimeout(() => {
        timer.current = null;
        heldOpen.current = !keepsClick && !shownNow.current;
        setShown(true);
      }, holdMs);
    },
    onPointerUp: release,
    onPointerCancel: () => { heldOpen.current = false; release(); },
    // A window or menu focuses its first control as it opens, and a window regaining focus gives it
    // back; only a keyboard's focus reveals, on the owner or a control inside it.
    onFocus: (e) => { if (!pressing.current && focusVisible(e.target)) setShown(true); },
    onBlur: (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShown(false); },
  };
  if (!keepsClick) {
    // A finger's leave comes between its release and the click, so the mark outlives the leave; a
    // key's click (`detail` 0) is never the end of a hold and clears it instead.
    bind.onClickCapture = (e) => {
      const held = heldOpen.current;
      heldOpen.current = false;
      if (!held || e.detail === 0) return;
      e.preventDefault();
      e.stopPropagation();
    };
  }
  return { shown, bind, touch };
}

/** `props` spread over `bind`, where a handler both name runs the reveal's first and then the
 *  caller's, so a caller's own pointer, focus or click handler never drops the reveal. A click the
 *  reveal swallowed stops there, as it would between two listeners. */
export function withBind<B extends object, P extends object>(bind: B, props: P): B & P {
  const merged: Record<string, unknown> = { ...bind, ...props } as Record<string, unknown>;
  const theirs = props as Record<string, unknown>;
  for (const [key, own] of Object.entries(bind)) {
    const other = theirs[key];
    if (typeof own !== 'function') continue;
    // A handler the caller leaves undefined keeps the reveal's.
    if (typeof other !== 'function') { merged[key] = own; continue; }
    merged[key] = (e: { isPropagationStopped?: () => boolean }, ...rest: unknown[]) => {
      own(e, ...rest);
      if (!e?.isPropagationStopped?.()) other(e, ...rest);
    };
  }
  return merged as B & P;
}

/** Whether `el`'s focus shows as the keyboard's (`:focus-visible`); an engine without the selector
 *  counts every focus. */
function focusVisible(el: Element): boolean {
  try { return el.matches(':focus-visible'); } catch { return true; }
}
