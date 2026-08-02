/**
 * The device signals behind the "please rotate" overlay, and the decision they feed.
 *
 * The UI is not designed for a phone or tablet held in portrait, but a portrait DESKTOP window
 * (a portrait monitor, or just a narrow browser window) is completely normal and must never be
 * blocked. The two cases cannot be told apart by window/viewport dimensions alone, so this reads
 * a device signal instead of an aspect ratio:
 *
 *   - `pointer: coarse` + `hover: none` together are the media-query signature of a touch-PRIMARY
 *     device. Both describe the primary pointing device, not the window, so neither can be true on
 *     a desktop however the window is sized. A touchscreen laptop driven by a mouse reports
 *     `hover: hover`. A tablet with a mouse attached keeps reporting `pointer: coarse`/`hover: none`
 *     on most engines (the touchscreen stays primary), so this fires for it too; the guard's
 *     `dismiss` is the way through.
 *   - `portrait`, from `screen.orientation` (the physical orientation of the DEVICE), never from
 *     comparing `innerWidth`/`innerHeight`. A software keyboard resizes the viewport, not the
 *     device: a phone held in landscape with a keyboard open stays `landscape-*` in
 *     `screen.orientation.type` even though the visible layout area shrinks, so it can never be
 *     misread as portrait. See `readDeviceOrientation` for the fallback where `screen.orientation`
 *     is unavailable.
 *
 * This sits under the UI rather than beside `usePortraitGuard` because the STORE seeds its
 * `portraitBlocked` slice from `detectPortraitBlocked()`: the tour's first-launch check reads that
 * slice during App's first render, before any effect has run, so the answer has to exist before
 * the component that owns the live subscription mounts.
 */

import { isInAppBrowser } from './browser-env';

/** The already-resolved signals the decision needs, as booleans: the decision itself touches no
 *  browser API. */
export interface OrientationSignals {
  /** `matchMedia('(pointer: coarse)').matches` */
  coarsePointer: boolean;
  /** `matchMedia('(hover: none)').matches` */
  noHover: boolean;
  /** The page is inside an app's built-in browser (see `browser-env`). */
  inAppBrowser: boolean;
  /** The device is physically portrait right now (see `readDeviceOrientation`). */
  portrait: boolean;
}

/**
 * Pure predicate: block only a touch-primary device that is actually held in portrait.
 *
 * `coarsePointer` is the part that can never be true on a desktop, so it is required. `noHover`
 * normally rides with it, but several in-app WebViews report `hover: hover` on a phone, which left
 * the guard silent exactly where it was needed; being in one of those is itself evidence of a phone,
 * so it stands in. Neither substitute can fire on a desktop, which is the property that matters.
 */
export function shouldBlockPortrait(signals: OrientationSignals): boolean {
  return signals.coarsePointer && (signals.noHover || signals.inAppBrowser) && signals.portrait;
}

/** Every `screen.orientation.type` value is one of four strings, prefixed `portrait-` or
 *  `landscape-` (…-primary / …-secondary, the two ways a device rotates into either aspect). */
export function orientationTypeIsPortrait(type: string): boolean {
  return type.startsWith('portrait');
}

/**
 * The device's physical orientation. Prefers `screen.orientation.type`, which reflects the
 * hardware sensor and so cannot be perturbed by a software keyboard, page zoom, or split-view
 * resize. Falls back to the CSS `orientation` media feature (then a raw dimension compare) for
 * engines that never shipped `screen.orientation` (older iOS Safari); that fallback IS
 * viewport-based, so it does not carry the keyboard-proof guarantee.
 */
export function readDeviceOrientation(): boolean {
  if (typeof screen !== 'undefined' && screen.orientation?.type) {
    return orientationTypeIsPortrait(screen.orientation.type);
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(orientation: portrait)').matches;
  }
  if (typeof window !== 'undefined') {
    return window.innerHeight > window.innerWidth;
  }
  return false;
}

/** `matchMedia(query).matches`, false where `matchMedia` does not exist (SSR / an old engine). */
export function readMatch(query: string): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

/** All three live signals, read once. */
export function readOrientationSignals(): OrientationSignals {
  return {
    coarsePointer: readMatch('(pointer: coarse)'),
    noHover: readMatch('(hover: none)'),
    inAppBrowser: isInAppBrowser(),
    portrait: readDeviceOrientation(),
  };
}

/** The blocked answer for right now, with no subscription behind it: the store's seed. */
export function detectPortraitBlocked(): boolean {
  return shouldBlockPortrait(readOrientationSignals());
}
