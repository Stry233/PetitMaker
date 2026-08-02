import { describe, it, expect } from 'vitest';
import {
  CameraInertia, FOLLOW_TAU_MS, GLIDE_TAU_MS, MIN_TRAVEL_PX, STALE_MS,
} from '../../canvas/map3d/scene/camera-inertia';

const FRAME = 16;

/** Drag at a steady `pxPerFrame`, draining the accumulator each frame the way the render loop
 *  does. Returns the clock and how much the camera actually moved. */
function drag(i: CameraInertia, pxPerFrame: number, frames: number, from = 0) {
  let t = from, applied = 0;
  for (let f = 0; f < frames; f++) {
    t += FRAME;
    i.sample(pxPerFrame, 0, t);
    applied += i.step(t)?.dx ?? 0;
  }
  return { t, applied };
}

/** Run frames until the accumulator is empty; returns the travel and how long it took. */
function settle(i: CameraInertia, from: number) {
  let t = from, total = 0, frames = 0;
  while (i.isSettling()) {
    t += FRAME;
    total += i.step(t)?.dx ?? 0;
    if (++frames > 2000) throw new Error('never settled');
  }
  return { total, frames, t };
}

describe('mass on the way in', () => {
  it('trails the hand rather than tracking it exactly', () => {
    // The lag IS the weight. A camera that applies every delta the instant it arrives also applies
    // every tremor of the hand holding the mouse.
    const i = new CameraInertia();
    const { applied } = drag(i, 10, 6);
    expect(applied).toBeLessThan(60);
    expect(applied).toBeGreaterThan(30); // trailing, not sluggish
  });

  it('catches up once the hand stops, losing no travel', () => {
    // Under-travelling permanently would decouple the map from the cursor dragging it. The
    // accumulator is always emptied, so the total is what was asked for, to within the last
    // sub-quarter-pixel (dropped rather than crawled out over more frames).
    const i = new CameraInertia();
    const run = drag(i, 10, 20);
    const rest = settle(i, run.t);
    expect(run.applied + rest.total).toBeGreaterThan(200 - MIN_TRAVEL_PX);
    expect(run.applied + rest.total).toBeLessThanOrEqual(200);
  });

  it('spends most of the catch-up in the first few frames', () => {
    // The tail is exponential, so "settled" is a long thin crawl; what matters for feel is that the
    // visible part of the catch-up is over quickly.
    const i = new CameraInertia();
    const run = drag(i, 10, 20);
    let t = run.t, early = 0;
    for (let f = 0; f < 4; f++) { t += FRAME; early += i.step(t)?.dx ?? 0; }
    const remaining = settle(i, t).total;
    expect(early / (early + remaining)).toBeGreaterThan(0.75);
  });

  it('trails by a distance set by SPEED, so a slow careful drag stays under the hand', () => {
    // Steady-state lag is velocity x tau, in PIXELS. That is the property that makes this usable
    // for framing: weight shows up when you throw the camera, not when you nudge it into place.
    const nudge = new CameraInertia();
    const slow = drag(nudge, 1.5, 20);
    const fling = new CameraInertia();
    const fast = drag(fling, 15, 20);
    expect(1.5 * 20 - slow.applied).toBeLessThan(6);      // a few px behind: reads as attached
    expect(15 * 20 - fast.applied).toBeGreaterThan(20);   // visibly heavy
  });

  it('applies about 1-1/e of a single step over one time constant', () => {
    const i = new CameraInertia();
    i.sample(100, 0, 0);
    let t = 0, applied = 0;
    while (t < FOLLOW_TAU_MS) { t += FRAME; applied += i.step(t)?.dx ?? 0; }
    expect(applied).toBeGreaterThan(100 * (1 - Math.exp(-1)) * 0.85);
    expect(applied).toBeLessThan(100 * (1 - Math.exp(-1)) * 1.25);
  });

  it('opens a gesture with a real frame of travel, not the clamp floor', () => {
    // The first drain has no previous frame to measure; assuming the 4ms floor would make the
    // opening frame of every drag apply almost nothing, which reads as a stutter.
    const i = new CameraInertia();
    i.sample(100, 0, 0);
    expect(i.step(FRAME)!.dx).toBeGreaterThan(100 * (1 - Math.exp(-FRAME / FOLLOW_TAU_MS)) * 0.9);
  });
});

describe('mass on the way out', () => {
  it('keeps going after release, further than the hand went in its last frame', () => {
    const i = new CameraInertia();
    const { t } = drag(i, 8, 20);
    i.release(t);
    expect(i.isCoasting()).toBe(true);
    const { total } = settle(i, t);
    expect(total).toBeGreaterThan(8);
  });

  it('throws about one glide time constant of travel, so a flick cannot run away', () => {
    const i = new CameraInertia();
    const { t } = drag(i, 8, 30);                 // 0.5 px/ms
    i.release(t);
    const { total } = settle(i, t);
    expect(total).toBeGreaterThan(0.5 * GLIDE_TAU_MS * 0.6);
    expect(total).toBeLessThan(0.5 * GLIDE_TAU_MS * 1.4);
  });

  it('glides longer than it follows, so the release reads as a coast and not a snap', () => {
    const follow = new CameraInertia();
    drag(follow, 10, 20);
    follow.cancel();
    const fresh = new CameraInertia();
    const run = drag(fresh, 10, 20);
    const followFrames = settle(fresh, run.t).frames;

    const glide = new CameraInertia();
    const g = drag(glide, 10, 20);
    glide.release(g.t);
    expect(settle(glide, g.t).frames).toBeGreaterThan(followFrames);
  });

  it('does not throw when the hand STOPPED before letting go', () => {
    // Dragging fast then holding still means "put it exactly here".
    const i = new CameraInertia();
    const { t } = drag(i, 20, 10);
    settle(i, t);                                 // let the follow finish
    i.release(t + STALE_MS + 1);
    expect(settle(i, t + STALE_MS + 1).total).toBe(0);
  });

  it('glides further for a faster drag', () => {
    const slow = new CameraInertia();
    const s = drag(slow, 3, 30);
    slow.release(s.t);
    const fast = new CameraInertia();
    const f = drag(fast, 12, 30);
    fast.release(f.t);
    expect(settle(fast, f.t).total).toBeGreaterThan(settle(slow, s.t).total);
  });

  it('carries both axes', () => {
    const i = new CameraInertia();
    let t = 0;
    for (let f = 0; f < 20; f++) { t += FRAME; i.sample(6, -4, t); i.step(t); }
    i.release(t);
    const s = i.step(t + FRAME)!;
    expect(s.dx).toBeGreaterThan(0);
    expect(s.dy).toBeLessThan(0);
  });
});

describe('measuring the drag', () => {
  it('cannot read a huge velocity out of two events in the same millisecond', () => {
    const i = new CameraInertia();
    i.sample(5, 0, 100);
    i.sample(5, 0, 100);
    i.release(100);
    expect(Number.isFinite(settle(i, 100).total)).toBe(true);
    expect(settle(new CameraInertia(), 0).total).toBe(0);
  });

  it('reads a stuttered gap as a SLOW drag, never a fast one', () => {
    const stuttered = new CameraInertia();
    stuttered.sample(5, 0, 0);
    stuttered.sample(5, 0, 400);
    stuttered.release(400);
    const steady = new CameraInertia();
    const s = drag(steady, 5, 2);
    steady.release(s.t);
    expect(settle(stuttered, 400).total).toBeLessThan(settle(steady, s.t).total);
  });
});

describe('taking the camera back', () => {
  it('drops the remaining throw when a new gesture starts mid-glide', () => {
    // Otherwise the new drag inherits the old one's momentum and overshoots where it was aimed.
    const i = new CameraInertia();
    const { t } = drag(i, 20, 20);
    i.release(t);
    i.step(t + FRAME);
    expect(i.isCoasting()).toBe(true);
    i.sample(1, 0, t + 32);
    expect(i.isCoasting()).toBe(false);
    expect(settle(i, t + 32).total).toBeLessThan(2); // just the 1px asked for, no inherited throw
  });

  it('hands back everything owed on a flush, so a mode switch applies nothing through the wrong verb', () => {
    const i = new CameraInertia();
    i.sample(30, 7, 0);
    const owed = i.flush()!;
    expect(owed).toEqual({ dx: 30, dy: 7 });
    expect(i.isSettling()).toBe(false);
    expect(i.flush()).toBeNull();
  });

  it('forgets everything on cancel', () => {
    const i = new CameraInertia();
    const { t } = drag(i, 20, 20);
    i.release(t);
    i.cancel();
    expect(i.isCoasting()).toBe(false);
    expect(i.step(t + FRAME)).toBeNull();
  });

  it('stops rather than crawling below the visible threshold', () => {
    const i = new CameraInertia();
    i.sample(MIN_TRAVEL_PX * 0.5, 0, 0);
    expect(i.step(FRAME)).toBeNull();
  });
});
