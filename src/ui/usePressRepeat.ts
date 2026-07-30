import { useEffect, useRef } from 'react';

export interface PressRepeatOptions {
  /** The action to fire on press and on each repeat tick. */
  action: () => void;
  /** Optional gate: when it returns false the action is skipped / repeating stops
   *  (e.g. nothing left to undo). Read fresh on every tick. */
  canRepeat?: () => boolean;
  /** Delay before the first repeat after the initial press fire. */
  delayMs?: number;
  /** Steady interval between repeats once repeating has begun. */
  intervalMs: number;
}

export interface PressRepeatHandlers {
  onPointerDown: (e: { button: number }) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
}

/**
 * Press-and-hold to repeat a button action: fires once on press, then after an
 * initial delay repeats at a steady interval until release / leave / cancel.
 * Stops early if canRepeat() turns false (e.g. nothing left to undo). Returns
 * handlers to spread on a <button>; keyboard activation (Enter/Space -> click)
 * still fires once via the deduped onClick.
 */
export function usePressRepeat({
  action,
  canRepeat,
  delayMs = 350,
  intervalMs,
}: PressRepeatOptions): PressRepeatHandlers {
  // Keep the latest predicates so timers read fresh values, not a stale closure.
  const actionRef = useRef(action);
  const canRepeatRef = useRef(canRepeat);
  actionRef.current = action;
  canRepeatRef.current = canRepeat;

  // Other code in this project treats timer ids as numbers; mirror that.
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
    if (canRepeatRef.current?.() === false) return;
    actionRef.current();
    delayTimer.current = window.setTimeout(() => {
      intervalTimer.current = window.setInterval(() => {
        if (canRepeatRef.current && !canRepeatRef.current()) { stop(); return; }
        actionRef.current();
      }, intervalMs);
    }, delayMs);
  };

  const onClick = () => {
    if (pointerHandled.current) { pointerHandled.current = false; return; } // dedupe synthetic click after a pointer press
    actionRef.current(); // keyboard activation (no preceding pointerdown)
  };

  return { onPointerDown, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop, onClick };
}
