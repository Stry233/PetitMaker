/**
 * What touch gestures hand to the layers above the view: the two-finger tap's action, which the
 * editor registers, and the long presses under way (on the map, or on a control a hold lifts), which
 * the interface draws as a ring filling by each finger. Each press owns its ring, so one press
 * never removes another's.
 */
import { createSignal } from '../../../core/base/signal';

let twoFingerTap: (() => void) | null = null;

/** Registers what a two-finger tap on the map does; null for nothing. */
export function setTwoFingerTapHandler(fn: (() => void) | null): void {
  twoFingerTap = fn;
}

/** A two-finger tap landed on the map. */
export function runTwoFingerTap(): void {
  twoFingerTap?.();
}

/** Where a held press stands: `map`, a press on the map whose hold opens a menu, ringed around the
 *  finger under the chrome; `control`, a press on a control whose hold lifts it, ringed above the
 *  finger over every surface. */
type HoldPlace = 'map' | 'control';

/** A still press whose hold acts: where it landed, in layout px, where it stands, and a fresh `id`
 *  per press. */
export interface HoldPress { x: number; y: number; place: HoldPlace; id: number }

const NONE: readonly HoldPress[] = [];
const holding = createSignal<readonly HoldPress[]>(NONE);
let presses = 0;

/** A press that acts once held started at `at`, in layout px; returns the press's `id`. */
export function showHoldPress(at: { x: number; y: number }, place: HoldPlace = 'map'): number {
  presses += 1;
  holding.emit([...holding.get(), { x: at.x, y: at.y, place, id: presses }]);
  return presses;
}

/** Press `id` resolved, moved or lifted: its ring goes, and every other press keeps its own. */
export function clearHoldPress(id: number): void {
  const now = holding.get();
  if (now.some((p) => p.id === id)) holding.emit(now.filter((p) => p.id !== id));
}

/** The presses being held, oldest first. */
export function holdPresses(): readonly HoldPress[] {
  return holding.get();
}

export function onHoldPressChange(listener: () => void): () => void {
  return holding.subscribe(listener);
}
