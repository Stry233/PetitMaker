import { describe, expect, it } from 'vitest';
import { PaletteSampler } from '../../../../pipelines/planet-scan/ground/color';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import { StillRunGrouper, type StillRun } from '../../../../pipelines/planet-scan/track/still-runs';
import { KeptFrames, MotionThinner } from '../../../../pipelines/planet-scan/track/thin';
import { Tracker } from '../../../../pipelines/planet-scan/track/track';
import { broadbandField, cropAt } from '../synthetic';

const { width: TW, height: TH } = SCAN_PROFILE.tile;
const { maxShift, maxGap } = SCAN_PROFILE.tracking.thinning;
const limitX = maxShift.x * TW;
const limitY = maxShift.y * TH;

describe('the thinning decision', () => {
  it('drops the frames of a slow pan, as far as the distinct-frame gap allows', () => {
    const t = new MotionThinner(TW, TH);
    t.kept(0, null, false);
    t.kept(1, { dx: -1, dy: 0.5 }, false);
    // Frame 2 may go when frame 3 lies near enough frame 1.
    expect(t.mayDrop(3)).toBe(true);
    expect(t.mayDrop(1 + maxGap)).toBe(true);
    expect(t.mayDrop(2 + maxGap)).toBe(false);
  });

  it('keeps a frame when the next one would lie beyond the shift limit on either axis', () => {
    const fastX = new MotionThinner(TW, TH);
    fastX.kept(0, null, false);
    fastX.kept(1, { dx: 0.6 * limitX, dy: 0 }, false);
    expect(fastX.mayDrop(3)).toBe(false);
    const fastY = new MotionThinner(TW, TH);
    fastY.kept(0, null, false);
    fastY.kept(1, { dx: 0, dy: -0.6 * limitY }, false);
    expect(fastY.mayDrop(3)).toBe(false);
  });

  it('measures the speed over the distinct frames a kept step spans', () => {
    const t = new MotionThinner(TW, TH);
    t.kept(0, null, false);
    // Four distinct frames for 0.4 of the limit: 0.1 of it a frame.
    t.kept(4, { dx: 0.4 * limitX, dy: 0 }, false);
    expect(t.mayDrop(4 + Math.min(maxGap, 9))).toBe(true);
    expect(t.mayDrop(4 + 11)).toBe(false);
  });

  it('accepts a measured shift only within the limit on both axes', () => {
    const t = new MotionThinner(TW, TH);
    expect(t.within({ dx: -limitX, dy: limitY })).toBe(true);
    expect(t.within({ dx: limitX + 0.5, dy: 0 })).toBe(false);
    expect(t.within({ dx: 0, dy: -limitY - 0.5 })).toBe(false);
  });

  it('keeps every frame while the motion is unknown', () => {
    const t = new MotionThinner(TW, TH);
    expect(t.mayDrop(1)).toBe(false);
    t.kept(0, null, false);
    expect(t.mayDrop(1)).toBe(false);
    t.kept(1, null, false);
    expect(t.mayDrop(3)).toBe(false);
  });

  it('keeps the frame after a still run starts, where the camera paused', () => {
    const t = new MotionThinner(TW, TH);
    t.kept(0, null, false);
    t.kept(1, { dx: 1, dy: 0 }, true);
    expect(t.mayDrop(3)).toBe(false);
  });
});

describe('the kept frames', () => {
  const FIELD_W = 1024;
  const FIELD_H = 512;
  const field = broadbandField(21, FIELD_W, FIELD_H)(0, 0, { width: FIELD_W, height: FIELD_H });
  /** A slow pan right and down, 1.5 and 0.25 pixels a frame, pausing after frames 60 and 120. */
  const pauses = new Set([60, 120]);
  const pan = Array.from({ length: 180 }, (_, k) => ({ x: 4 + 1.5 * k, y: 4 + 0.25 * k }));

  const grouper = new StillRunGrouper(TW, TH);
  const tracker = new Tracker(TW >> 1, TH >> 1, { step: 2 });
  const kept = new KeptFrames(tracker, new PaletteSampler(TW, TH), TW, TH, 10_000);
  const runs: StillRun[] = [];
  /** The pan's frame index of each distinct frame. */
  const distinctAt: number[] = [];
  /** The pan's frame index shown at each time. */
  const shownAt: number[] = [];
  const show = (k: number) => {
    const time = shownAt.push(k) - 1;
    const tile = cropAt(field, { x: pan[k]!.x, y: pan[k]!.y }, { width: TW, height: TH });
    const verdict = grouper.push(tile);
    if (verdict.distinct) distinctAt.push(k);
    const run = kept.push(verdict, tile, (out) => out.fill(128), time);
    if (run) runs.push(run);
  };
  for (let k = 0; k < pan.length; k++) {
    show(k);
    if (pauses.has(k)) for (let r = 1; r < SCAN_PROFILE.stillRunMinFrames + 4; r++) show(k);
  }
  const last = kept.finish(grouper.finish());
  if (last) runs.push(last);
  const frameAt = (keptIndex: number) => shownAt[kept.times[keptIndex]!]!;

  it('thins a slow pan to a fraction of its distinct frames, every kept step verified', () => {
    expect(distinctAt.length).toBe(pan.length);
    expect(kept.kept).toBeLessThan(pan.length / 3);
    expect(tracker.lost).toBe(0);
  });

  it('keeps the frames still runs start at and returns the runs by kept frame', () => {
    expect(runs.map((r) => frameAt(r.distinct))).toEqual([60, 120]);
  });

  it('keeps the frame after each still run and the last frame', () => {
    const keptFrames = kept.times.map((_, i) => frameAt(i));
    expect(keptFrames).toContain(61);
    expect(keptFrames).toContain(121);
    expect(keptFrames[keptFrames.length - 1]).toBe(pan.length - 1);
  });

  it('places the kept frames where the camera was', () => {
    const chain = tracker.chainPath();
    for (let i = 0; i < kept.kept; i++) {
      const f = frameAt(i);
      expect(Math.abs(chain.x[i]! - (pan[f]!.x - pan[0]!.x))).toBeLessThan(1.5);
      expect(Math.abs(chain.y[i]! - (pan[f]!.y - pan[0]!.y))).toBeLessThan(1.5);
    }
  });

  it('keeps the frame before a jump the speed did not predict', () => {
    const g = new StillRunGrouper(TW, TH);
    const tr = new Tracker(TW >> 1, TH >> 1, { step: 2 });
    const kf = new KeptFrames(tr, new PaletteSampler(TW, TH), TW, TH, 10_000);
    const xs = [...Array.from({ length: 20 }, (_, k) => 4 + k), 23 + 3 * limitX, 24 + 3 * limitX, 25 + 3 * limitX];
    xs.forEach((x, k) => {
      const tile = cropAt(field, { x, y: 4 }, { width: TW, height: TH });
      kf.push(g.push(tile), tile, (out) => out.fill(128), k);
    });
    kf.finish(g.finish());
    expect(kf.times).toContain(19);
    expect(tr.lost).toBe(0);
    const chain = tr.chainPath();
    kf.times.forEach((k, i) => expect(Math.abs(chain.x[i]! - (xs[k]! - xs[0]!))).toBeLessThan(1.5));
  });

  it('never leaves a kept step longer than the shift limit allows for a steady pan', () => {
    for (let i = 1; i < kept.kept; i++) {
      const step = frameAt(i) - frameAt(i - 1);
      expect(step).toBeLessThanOrEqual(maxGap);
      expect(1.5 * step).toBeLessThanOrEqual(limitX);
    }
  });
});
