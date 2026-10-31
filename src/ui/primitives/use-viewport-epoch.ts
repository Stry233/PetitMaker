/*
 * "the room has changed", as one render input.
 *
 * Two things move the geometry a measured layout was derived from, and neither is a change to any
 * prop or to any store fact the surface is reading: the window resizing, and the interface's own
 * scale moving under the user's Ctrl +/-. The first fires a `resize`; the second fires nothing at
 * all (it is a css `zoom`, and no event reports one), which is why a hook that only listened would
 * miss half of it. Anything that measured a box, pinned a scroll position or remembered a height has
 * to run again on both, and this is the one signal that says so.
 *
 * A string, so it can be a dependency and a key alike: two viewports that agree in every term the
 * layout depends on produce the same value, and a hook comparing it can tell "the room moved" from
 * "the content changed" without a second reading of its own.
 */
import { useSyncExternalStore } from 'react';
import { subscribeViewportSize, viewportSizeSnapshot } from '../../platform/device/viewport-space';
import { useChromeScale } from '../design/scale';

const noWindow = () => null;

export function useViewportEpoch(): string {
  // The settled reading: a surface re-measuring off this measures once the scale lands.
  const scale = useChromeScale();
  // The window's own box, or '' where there is no window (a server render).
  const size = useSyncExternalStore(subscribeViewportSize, viewportSizeSnapshot, noWindow);
  const box = size ? `${size.width}x${size.height}` : '';
  return `${box}@${scale}`;
}
