import { useEffect, useState } from 'react';
import {
  readOrientationSignals,
  shouldBlockPortrait,
  type OrientationSignals,
} from '../../core/runtime/portrait-signals';

/**
 * The live half of the portrait blocker: the signals as React state, plus the orientation-lock
 * escape hatch. What the signals ARE and why they are the right ones lives in
 * `core/runtime/portrait-signals`, which the store also reads to seed itself.
 */

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
    typeof window === 'undefined' ? { coarsePointer: false, noHover: false, portrait: false } : readOrientationSignals(),
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const update = () => setSignals(readOrientationSignals());
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
