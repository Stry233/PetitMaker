/**
 * The weight of the camera, pure and three-free so the feel is unit-testable. One accumulator of
 * unapplied travel, drained at two rates: a drag adds to it and it drains fast, so the camera trails
 * the hand by a few frames and fine framing does not carry the hand's tremor; on release the
 * measured velocity is extrapolated into it and drains slowly, the glide. Total travel is exactly
 * what was dragged plus the throw.
 *
 * OrbitControls' `enableDamping` needs to own the pointers, which the pointer machine owns here, so
 * this lives on the camera verbs both 3D views reach. Everything is in screen pixels, for orbit and
 * pan alike.
 */

/** Unapplied travel decays by 1/e over this long while the hand is down. The camera reaches ~95% of
 *  the hand's position in ~3 frames at 60fps: enough lag to read as mass and to swallow a tremor,
 *  short enough that the map never feels detached from the cursor dragging it. */
const FOLLOW_TAU_MS = 45;

/** And by 1/e over this long once the hand is gone. Longer than the follow, because a glide is
 *  meant to be watched rather than kept up with. */
const GLIDE_TAU_MS = 260;

/** Below this much unapplied travel there is nothing left worth a frame: a quarter pixel is under
 *  the visible threshold, and stopping there keeps the camera-rest detector from being fed motion
 *  no one can see. */
const MIN_TRAVEL_PX = 0.25;

/** A pointer that has not moved for this long is held still, not gliding. Releasing then must not
 *  throw: coasting from a velocity measured before the pause is the classic fling-on-release bug. */
const STALE_MS = 60;

/** Frame-to-frame sample gaps outside this range are the event stream stuttering, not the hand
 *  moving faster; clamping keeps one late frame from inventing a huge velocity. */
const MIN_DT_MS = 4;
const MAX_DT_MS = 64;

/** What the first drain of a fresh accumulator assumes has passed, having no previous frame to
 *  measure against. A nominal frame, not the floor: the floor would make the opening frame of every
 *  gesture apply almost nothing, which reads as a stutter at the start of a drag. */
const NOMINAL_FRAME_MS = 16;

/** How much of each new measurement replaces the running velocity estimate. Low enough to ride out
 *  one jittery sample, high enough that a flick's last few events still dominate. */
const SMOOTHING = 0.35;

export interface InertiaStep { dx: number; dy: number }

export interface InertiaOptions {
  /** Below this much unapplied travel the glide is over. Defaults to `MIN_TRAVEL_PX`, which is the
   *  right floor for screen pixels; an axis in other units (the dolly accumulates log of a distance
   *  factor) sets its own. */
  minTravel?: number;
  /** How fast the accumulator drains while the input is live. Defaults to `FOLLOW_TAU_MS`. */
  followTau?: number;
}

export class CameraInertia {
  /** Travel the hand (or the throw) has asked for and the camera has not applied yet. */
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private lastSampleMs: number | null = null;
  private lastStepMs: number | null = null;
  private coasting = false;
  private readonly minTravel: number;
  private readonly followTau: number;

  constructor(opts: InertiaOptions = {}) {
    this.minTravel = opts.minTravel ?? MIN_TRAVEL_PX;
    this.followTau = opts.followTau ?? FOLLOW_TAU_MS;
  }

  /** Feed one drag step (screen px since the previous one). Ends any glide: the hand is back on
   *  the camera, and what it asks for now is the whole story. */
  sample(dx: number, dy: number, nowMs: number): void {
    if (this.coasting) {
      // The glide's remaining throw is not part of the new gesture.
      this.px = 0;
      this.py = 0;
      this.coasting = false;
    }
    this.px += dx;
    this.py += dy;
    if (this.lastSampleMs !== null) {
      const dt = Math.min(MAX_DT_MS, Math.max(MIN_DT_MS, nowMs - this.lastSampleMs));
      this.vx += (dx / dt - this.vx) * SMOOTHING;
      this.vy += (dy / dt - this.vy) * SMOOTHING;
    }
    this.lastSampleMs = nowMs;
  }

  /** The drag ended. Extrapolates the measured velocity into the accumulator — that throw is the
   *  glide — unless the pointer had already come to a stop. */
  release(nowMs: number): void {
    const stale = this.lastSampleMs === null || nowMs - this.lastSampleMs > STALE_MS;
    if (!stale) {
      this.px += this.vx * GLIDE_TAU_MS;
      this.py += this.vy * GLIDE_TAU_MS;
    }
    this.vx = 0;
    this.vy = 0;
    this.lastSampleMs = null;
    // Coasting even with nothing thrown: what the hand asked for last still has to drain, and it
    // should drain at the glide rate now that there is no hand to keep up with.
    this.coasting = true;
  }

  /** The travel to apply this frame, or null when the camera has caught up. Call every frame — the
   *  accumulator drains during a drag too, which is where the weight comes from. */
  step(nowMs: number): InertiaStep | null {
    if (Math.hypot(this.px, this.py) < this.minTravel) {
      if (this.coasting) this.settle();
      this.lastStepMs = nowMs;
      return null;
    }
    const dt = this.lastStepMs === null
      ? NOMINAL_FRAME_MS
      : Math.min(MAX_DT_MS, Math.max(MIN_DT_MS, nowMs - this.lastStepMs));
    this.lastStepMs = nowMs;
    const k = 1 - Math.exp(-dt / (this.coasting ? GLIDE_TAU_MS : this.followTau));
    const move = { dx: this.px * k, dy: this.py * k };
    this.px -= move.dx;
    this.py -= move.dy;
    return move;
  }

  /** Everything still owed, at once. The caller switches between orbiting and panning by flushing:
   *  travel measured for one verb must never be applied through the other. */
  flush(): InertiaStep | null {
    if (this.px === 0 && this.py === 0) return null;
    const move = { dx: this.px, dy: this.py };
    this.settle();
    return move;
  }

  /** Drop the glide and everything behind it (a new view, reduced motion, teardown). */
  cancel(): void {
    this.px = 0;
    this.py = 0;
    this.settle();
  }

  isCoasting(): boolean {
    return this.coasting;
  }

  /** True while there is travel left to apply, whoever asked for it. */
  isSettling(): boolean {
    return Math.hypot(this.px, this.py) >= this.minTravel;
  }

  private settle(): void {
    this.px = 0;
    this.py = 0;
    this.vx = 0;
    this.vy = 0;
    this.coasting = false;
    this.lastSampleMs = null;
    this.lastStepMs = null;
  }
}
