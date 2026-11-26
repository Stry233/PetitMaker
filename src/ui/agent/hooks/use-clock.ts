/* Render clocks for the panel's elapsed-time readings. */
import { useEffect, useState } from 'react';

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
