/**
 * Detects when the orbit camera has come to VISUAL rest. Three-free and pure so
 * the decision logic is unit-testable.
 *
 * Orbit damping decays the gesture velocity exponentially, so it never truly
 * reaches zero: for a second-plus after every zoom/orbit the camera keeps
 * applying sub-visible per-frame motion. Each of those frames re-antialiases
 * every silhouette, and thin geometry (a flower at map-viewing distance)
 * toggles between coverage states — strobing borders on a scene that looks
 * still. Once per-frame motion stays below these visibility thresholds for
 * REST_FRAMES consecutive frames, the scene freezes the controls (skips
 * controls.update()) until the next gesture wakes it, cutting the strobe tail
 * while keeping the visible part of the glide.
 */

/** Per-frame rotation below this reads as a still image, not a glide: ≈0.25 px
 *  of edge travel per frame (~15 px/s) on a ~1000 px viewport. Above it, the
 *  eye tracks the motion and edge shimmer reads as movement; below it, the
 *  scene looks frozen while edges keep popping — the zone the freeze removes.
 *  Halting here discards only the glide's last ~3 px of total travel. */
export const REST_ANGLE = 2.5e-4;

/** Per-frame travel below this fraction of the orbit distance is the same
 *  ≈0.25 px screen-space displacement (screen scale ∝ 1/distance). */
export const REST_TRAVEL_RATIO = 2.5e-4;

/** Consecutive still frames required before declaring rest — a single quiet
 *  frame mid-gesture (e.g. between wheel notches) must not freeze the camera. */
export const REST_FRAMES = 4;

type Vec3Like = readonly [number, number, number] | number[];
type QuatLike = readonly [number, number, number, number] | number[];

export class CameraRestDetector {
  private lastPos: [number, number, number] | null = null;
  private lastQuat: [number, number, number, number] | null = null;
  private stillFrames = 0;
  private resting = false;

  /** Feed one rendered frame's camera pose (+ current orbit distance for the
   *  translation scale). Returns whether the camera is now at rest. */
  update(pos: Vec3Like, quat: QuatLike, orbitDistance: number): boolean {
    const p: [number, number, number] = [pos[0]!, pos[1]!, pos[2]!];
    const q: [number, number, number, number] = [quat[0]!, quat[1]!, quat[2]!, quat[3]!];
    if (this.lastPos && this.lastQuat) {
      const travel = Math.hypot(p[0] - this.lastPos[0], p[1] - this.lastPos[1], p[2] - this.lastPos[2]);
      const dot = Math.min(1, Math.abs(q[0] * this.lastQuat[0] + q[1] * this.lastQuat[1] + q[2] * this.lastQuat[2] + q[3] * this.lastQuat[3]));
      const angle = 2 * Math.acos(dot);
      if (angle < REST_ANGLE && travel < orbitDistance * REST_TRAVEL_RATIO) {
        if (++this.stillFrames >= REST_FRAMES) this.resting = true;
      } else {
        this.stillFrames = 0;
        this.resting = false;
      }
    }
    this.lastPos = p;
    this.lastQuat = q;
    return this.resting;
  }

  isResting(): boolean {
    return this.resting;
  }

  /** A gesture (or any external camera change) ended the rest. */
  wake(): void {
    this.resting = false;
    this.stillFrames = 0;
  }
}
