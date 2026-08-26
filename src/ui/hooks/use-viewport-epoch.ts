/*
 * use-viewport-epoch.ts — "the room has changed", as one render input.
 *
 * Two things move the geometry a measured layout was derived from, and neither is a change to any
 * prop or to any store fact the surface is reading: the WINDOW resizing, and the interface's own
 * scale moving under the user's Ctrl +/-. The first fires a `resize`; the second fires nothing at
 * all (it is a css `zoom`, and no event reports one), which is why a hook that only listened would
 * miss half of it. Anything that MEASURED a box, pinned a scroll position or remembered a height has
 * to run again on both, and this is the one signal that says so.
 *
 * A STRING, so it can be a dependency and a key alike: two viewports that agree in every term the
 * layout depends on produce the same value, and a hook comparing it can tell "the room moved" from
 * "the content changed" without a second reading of its own.
 */
import { useEffect, useState } from 'react';
import { useChromeScale } from '../design/scale';

/** The window's own box, or '' where there is no window (a test, a server render). */
function windowBox(): string {
  return typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight}`;
}

export function useViewportEpoch(): string {
  // The ANIMATED reading, so a surface re-measuring off this rides the zoom's glide rather than
  // jumping to the far end of it — the same reading the parked character is placed from.
  const scale = useChromeScale();
  const [box, setBox] = useState(windowBox);
  useEffect(() => {
    const onResize = () => setBox(windowBox());
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return `${box}@${scale}`;
}
