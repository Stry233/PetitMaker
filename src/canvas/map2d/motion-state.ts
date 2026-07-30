/**
 * motion-state.ts — the module-level animation gate the renderer rAF loops read
 * directly. Shared by React (the `useMotionEnabled` hook sets the flag) and the
 * PixiJS layers (they read it): one bundle, one singleton, so no `window` bridge
 * is needed for a plain shared flag. `motionReduced` mirrors
 * `prefers-reduced-motion`; when true, every animation primitive early-returns
 * to its end-state.
 */

let motionReduced = false;

export function setReducedMotion(reduced: boolean): void {
  motionReduced = reduced;
}

export function isMotionReduced(): boolean {
  return motionReduced;
}

/** Test-only: reset the gate to its default. */
export function __resetMotionState(): void {
  motionReduced = false;
}
