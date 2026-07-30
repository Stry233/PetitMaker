/**
 * A restored 3D camera angle awaiting the scene's construction. The 3D editor mounts its
 * ThreeScene LAZILY (first activation only — see Editor3DCanvas), so a camera restored before
 * that (the startup "resume from last" offer, applied before the user has ever opened 3D this
 * session) has nowhere to land yet. `setPendingCameraAngle` parks it here; the scene-construction
 * site (`Editor3DCanvas`'s build effect) takes it the moment a fresh ThreeScene exists and applies
 * it instead of running the intro fly-in. One module-level slot — like `motion-state`/
 * `render-scheduler` — because there is at most one outstanding restore to apply, never a queue.
 */
import type { CameraAngle } from '../capture';

let pending: CameraAngle | null = null;

/** Queue an angle for the next ThreeScene construction (or clear the queue with null). */
export function setPendingCameraAngle(angle: CameraAngle | null): void {
  pending = angle;
}

/** Consume the queued angle, if any — one-shot: a second read (before the next set) gets null. */
export function takePendingCameraAngle(): CameraAngle | null {
  const a = pending;
  pending = null;
  return a;
}
