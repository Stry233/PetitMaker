/*
 * A map handle's drag. From the press, the pressing pointer's moves and its end are heard on the window,
 * and only until the grab ends or the owner unmounts. The window rather than a pointer capture: a handle
 * re-renders and can unmount while held, a synthetic pointer cannot claim a capture, and a capture on the
 * handle would fight the canvas under it for the same events.
 */
import { useCallback, useEffect, useRef } from 'react';

interface WindowDragHandlers<G> {
  /** The held pointer moved; `grab` is what its press took hold of. */
  move: (e: PointerEvent, grab: G) => void;
  /** The held pointer let go. */
  end: (e: PointerEvent, grab: G) => void;
  /** The browser took the pointer away; heard as `end` where omitted. */
  cancel?: (e: PointerEvent, grab: G) => void;
}

interface WindowDrag<G> {
  /** Begins a grab of `grab` by the pointer that pressed, ending any grab still held. */
  start: (press: { pointerId?: number }, grab: G) => void;
  /** Ends the grab without hearing its end. */
  stop: () => void;
  /** Whether a grab is held. */
  held: () => boolean;
}

/** `handlers` are read as they stand at each event, so a re-render mid-drag is heard. */
export function useWindowDrag<G>(handlers: WindowDragHandlers<G>): WindowDrag<G> {
  const latest = useRef(handlers);
  latest.current = handlers;
  const release = useRef<(() => void) | null>(null);
  const stop = useCallback(() => { release.current?.(); }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback((press: { pointerId?: number }, grab: G) => {
    release.current?.();
    // A press that names no pointer (a synthetic one) is followed by any pointer.
    const ours = (e: PointerEvent) => press.pointerId === undefined || e.pointerId === press.pointerId;
    const move = (e: PointerEvent) => { if (ours(e)) latest.current.move(e, grab); };
    const up = (e: PointerEvent) => {
      if (!ours(e)) return;
      release.current?.();
      latest.current.end(e, grab);
    };
    const cancel = (e: PointerEvent) => {
      if (!ours(e)) return;
      release.current?.();
      (latest.current.cancel ?? latest.current.end)(e, grab);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    release.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      release.current = null;
    };
  }, []);

  const held = useCallback(() => release.current !== null, []);
  return { start, stop, held };
}
