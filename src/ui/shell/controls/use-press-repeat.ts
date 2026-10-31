/*
 * Press and hold to repeat.
 *
 * For a stepper and nothing else: a control whose action means something again when it is done
 * again, so holding it is a shorter way of pressing it several times. A toggle must never take it —
 * a held toggle flips back and forth, which is not what a hand asks for by staying still — and an
 * idempotent action gains nothing, so a row where half the buttons repeat and half only look as
 * though they might is a row that teaches nobody anything.
 */
import { useEffect, useRef } from 'react';

/** How long a press stands before it starts repeating, in ms. */
const REPEAT_DELAY_MS = 350;

interface PressRepeatOptions {
  /** The action to fire on press and on each repeat tick. */
  action: () => void;
  /** Steady interval between repeats once repeating has begun. */
  intervalMs: number;
}

interface PressRepeatHandlers {
  onPointerDown: (e: { button: number }) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
}

/**
 * Press-and-hold to repeat a button action: fires once on press, then after an
 * initial delay repeats at a steady interval until release / leave / cancel; a
 * control with nothing left to do is disabled, which ends the press. Returns
 * handlers to spread on a <button>; keyboard activation (Enter/Space -> click)
 * still fires once via the deduped onClick.
 */
export function usePressRepeat({ action, intervalMs }: PressRepeatOptions): PressRepeatHandlers {
  // The timers read the latest action, not the one of the render that started them.
  const actionRef = useRef(action);
  actionRef.current = action;

  const delayTimer = useRef<number>(0);
  const intervalTimer = useRef<number>(0);
  // True between a pointerdown and its synthetic click, so onClick can dedupe.
  const pointerHandled = useRef(false);

  const stop = () => {
    if (delayTimer.current !== 0) { clearTimeout(delayTimer.current); delayTimer.current = 0; }
    if (intervalTimer.current !== 0) { clearInterval(intervalTimer.current); intervalTimer.current = 0; }
  };

  // Clean up any pending timers on unmount.
  useEffect(() => stop, []);

  const onPointerDown = (e: { button: number }) => {
    if (e.button !== 0) return; // primary button only
    pointerHandled.current = true;
    actionRef.current();
    delayTimer.current = window.setTimeout(() => {
      intervalTimer.current = window.setInterval(() => actionRef.current(), intervalMs);
    }, REPEAT_DELAY_MS);
  };

  const onClick = () => {
    if (pointerHandled.current) { pointerHandled.current = false; return; } // dedupe synthetic click after a pointer press
    actionRef.current(); // keyboard activation (no preceding pointerdown)
  };

  /** A press that ended by leaving the button, which the browser answers with no click at all.
   *  Without this the dedupe flag stays raised and swallows the next keyboard activation. */
  const abandon = () => { pointerHandled.current = false; stop(); };

  return { onPointerDown, onPointerUp: stop, onPointerLeave: abandon, onPointerCancel: abandon, onClick };
}
