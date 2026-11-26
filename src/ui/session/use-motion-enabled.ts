import { useSyncExternalStore } from 'react';
import { isMotionReduced, onReducedMotionChange } from '../../platform/channels/motion-state';
import { osReducesMotion, watchOsReducedMotion } from '../../platform/device/os-motion';

/**
 * The reduced-motion decision as React reads it. The editor's session resolves the user's
 * preference against the OS reading and publishes the effective value
 * (`editor/session/install.ts:watchReducedMotion`), which reaches all three gates:
 *   - Framer/DOM: the edition root passes `reducedMotion="always" | "never"` from `useMotionEnabled()`;
 *   - canvas rAF loops (2D Pixi and the 3D scene): the `motion-state` module singleton;
 *   - CSS: `<html data-reduced-motion="1|0">`, which `ui/design/animations.css` keys off.
 * CSS cannot use the media query alone because it would ignore both overrides.
 */

/** Whether this device asks for reduced motion, updated live when the OS setting changes. */
export function useOsReducedMotion(): boolean {
  return useSyncExternalStore(watchOsReducedMotion, osReducesMotion, () => false);
}

/** Whether motion is reduced in force, as the session published it, for Framer's `MotionConfig`. */
export function useMotionEnabled(): boolean {
  return useSyncExternalStore(onReducedMotionChange, isMotionReduced, () => false);
}
