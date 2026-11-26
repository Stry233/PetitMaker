/**
 * The effective reduced-motion value every gate reads: the renderer rAF loops directly, Framer
 * through the hook that hands it to `MotionConfig`. The editor's session resolves and publishes it
 * (`editor/session/install.ts:watchReducedMotion`); when true, every animation primitive
 * early-returns to its end-state. One bundle, one singleton, so no `window` bridge is needed.
 */
import { createSignal } from '../../core/base/signal';

const motionReduced = createSignal(false);

export function setReducedMotion(reduced: boolean): void {
  if (motionReduced.get() !== reduced) motionReduced.emit(reduced);
}

export function isMotionReduced(): boolean {
  return motionReduced.get();
}

/** Calls `fn` whenever the effective value changes; returns the stop. */
export function onReducedMotionChange(fn: () => void): () => void {
  return motionReduced.subscribe(fn);
}

/** Test-only: reset the gate to its default. */
export function __resetMotionState(): void {
  setReducedMotion(false);
}
