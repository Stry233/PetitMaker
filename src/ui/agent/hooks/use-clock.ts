/* Render clocks for the panel's elapsed-time readings. */
import { useEffect, useRef, useState } from 'react';
import type { PanelView } from '../../../agent/panel';

/** Clock interval in ms; displayed times use whole seconds. */
const TICK_MS = 1000;

/** A one-second render clock, running only while a caller displays elapsed time. */
export function useSecondClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Signature of streaming progress that can advance without a persisted log event. */
function liveSignature(view: PanelView): string {
  const job = view.current;
  if (!job) return '';
  return `${job.thought?.chars ?? 0}|${job.says?.length ?? 0}|${job.ops.length}|${String(job.saysStreaming)}`;
}

/**
 * The newer of the persisted event time and observed streaming movement. The first observation does
 * not reset a restored session's silence, and `now` is the caller's shared clock.
 */
export function useLastActivity(view: PanelView, now: number): number {
  const sig = liveSignature(view);
  const seen = useRef<string | null>(null);
  const [movedAt, setMovedAt] = useState(0);
  useEffect(() => {
    if (seen.current === null) { seen.current = sig; return; }
    if (seen.current === sig) return;
    seen.current = sig;
    setMovedAt(now);
  }, [sig, now]);
  return Math.max(view.lastEventAt, movedAt);
}
