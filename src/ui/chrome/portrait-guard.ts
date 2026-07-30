import { useEffect, useState } from 'react';

/**
 * Decides whether to cover the app with a "please rotate" overlay.
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
 *     on most engines (the touchscreen stays primary), so this fires for it too; `dismiss` is the
 *     way through.
 *   - `portrait`, from `screen.orientation` (the physical orientation of the DEVICE), never from
 *     comparing `innerWidth`/`innerHeight`. A software keyboard resizes the viewport, not the
 *     device: a phone held in landscape with a keyboard open stays `landscape-*` in
 *     `screen.orientation.type` even though the visible layout area shrinks, so it can never be
 *     misread as portrait. See `readDeviceOrientation` for the fallback where `screen.orientation`
 *     is unavailable.
 */

/** The three already-resolved signals the decision needs, as booleans: the decision itself touches
 *  no browser API. */
export interface OrientationSignals {
  /** `matchMedia('(pointer: coarse)').matches` */
  coarsePointer: boolean;
  /** `matchMedia('(hover: none)').matches` */
  noHover: boolean;
  /** The device is physically portrait right now (see `readDeviceOrientation`). */
  portrait: boolean;
}

/** Pure predicate: block only a touch-primary device that is actually held in portrait. */
export function shouldBlockPortrait(signals: OrientationSignals): boolean {
  return signals.coarsePointer && signals.noHover && signals.portrait;
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
function readSignals(): OrientationSignals {
  return {
    coarsePointer: readMatch('(pointer: coarse)'),
    noHover: readMatch('(hover: none)'),
    portrait: readDeviceOrientation(),
  };
}

export interface PortraitGuard {
  /** Show the overlay right now. */
  blocked: boolean;
  /** The "continue anyway" escape hatch: hides the overlay while the device stays in portrait. */
  dismiss: () => void;
}

/**
 * Live version of `shouldBlockPortrait`, plus the orientation-lock escape hatch.
 *
 * `dismiss` is the way past the gate for a user with an OS-level orientation lock, who can never
 * satisfy it otherwise. It is not a one-shot: it holds while the device stays portrait and clears
 * the moment the device is next measured in LANDSCAPE. One rule, two behaviours — a device that
 * cannot rotate never meets the reset condition, so its dismissal lasts the session; a device that
 * can rotate re-arms the gate on its next return to portrait.
 */
export function usePortraitGuard(): PortraitGuard {
  const [signals, setSignals] = useState<OrientationSignals>(() =>
    typeof window === 'undefined' ? { coarsePointer: false, noHover: false, portrait: false } : readSignals(),
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const update = () => setSignals(readSignals());
    update();
    // Three listeners: each signal moves on its own. A mouse can be attached or removed
    // (pointer/hover) and the device can rotate without the input hardware changing.
    const pointerMq = window.matchMedia('(pointer: coarse)');
    const hoverMq = window.matchMedia('(hover: none)');
    const orientationMq = window.matchMedia('(orientation: portrait)');
    pointerMq.addEventListener('change', update);
    hoverMq.addEventListener('change', update);
    orientationMq.addEventListener('change', update);
    // Some engines fire `screen.orientation`'s own event instead of the media query, and a few only
    // ever fire the legacy window events.
    const so = typeof screen !== 'undefined' ? screen.orientation : undefined;
    so?.addEventListener?.('change', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    return () => {
      pointerMq.removeEventListener('change', update);
      hoverMq.removeEventListener('change', update);
      orientationMq.removeEventListener('change', update);
      so?.removeEventListener?.('change', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  // Re-arm the escape hatch once the device is actually seen in landscape (see the doc above).
  useEffect(() => {
    if (!signals.portrait && dismissed) setDismissed(false);
  }, [signals.portrait, dismissed]);

  return {
    blocked: shouldBlockPortrait(signals) && !dismissed,
    dismiss: () => setDismissed(true),
  };
}
