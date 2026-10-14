import { describe, expect, it } from 'vitest';
import { StillRunGrouper, meanAbsDiff } from '../../../../pipelines/planet-scan/track/still-runs';
import type { GreyImage } from '../../../../pipelines/planet-scan/types';
import { rng } from '../synthetic';

const W = 64;
const H = 32;

function ground(seed: number): Float32Array {
  const r = rng(seed);
  return Float32Array.from({ length: W * H }, () => 60 + r() * 120);
}

/** `base` with small sensor noise and an animated pixel at (10, 5) set to `line`. */
function frame(base: Float32Array, seed: number, line: number): GreyImage {
  const r = rng(seed);
  const data = base.map((v) => v + (r() * 2 - 1) * 0.3);
  data[5 * W + 10] = line;
  return { width: W, height: H, data };
}

describe('still runs', () => {
  it('measures frame difference on a subsample', () => {
    const a = { width: W, height: H, data: new Float32Array(W * H) };
    const b = { width: W, height: H, data: new Float32Array(W * H).fill(2) };
    expect(meanAbsDiff(a, b, 4)).toBe(2);
    expect(meanAbsDiff(a, a, 4)).toBe(0);
  });

  it('groups repeats after each distinct frame and reports runs long enough', () => {
    const grouper = new StillRunGrouper(W, H, { repeatThreshold: 0.6, sampleStep: 4, minFrames: 6 });
    const scenes = [ground(1), ground(2), ground(3)];
    const lengths = [8, 4, 11];
    const lines = [
      [100, 110, 120, 130, 100, 110, 120, 130],
      [90, 90, 90, 90],
      [50, 70, 50, 70, 50, 70, 50, 70, 50, 70, 50],
    ];
    const verdicts = [];
    const closed = [];
    let seed = 10;
    for (let s = 0; s < scenes.length; s++) {
      for (let f = 0; f < lengths[s]!; f++) {
        const v = grouper.push(frame(scenes[s]!, seed++, lines[s]![f]!));
        verdicts.push(v);
        if (v.closed) closed.push(v.closed);
      }
    }
    const last = grouper.finish();
    if (last) closed.push(last);

    expect(verdicts.filter((v) => v.distinct).length).toBe(3);
    expect(grouper.distinct).toBe(3);
    expect(verdicts.map((v) => v.index)).toEqual([...Array(8).fill(0), ...Array(4).fill(1), ...Array(11).fill(2)]);
    // The four-frame run is too short to report.
    expect(closed.map((r) => [r.distinct, r.frames])).toEqual([[0, 8], [2, 11]]);

    const stats = (values: number[]) => {
      const m = values.reduce((t, v) => t + v, 0) / values.length;
      return { mean: m, sd: Math.sqrt(values.reduce((t, v) => t + (v - m) ** 2, 0) / values.length) };
    };
    for (const [run, values] of [[closed[0]!, lines[0]!], [closed[1]!, lines[2]!]] as const) {
      const { mean, sd } = stats(values);
      expect(run.deviation.data[5 * W + 10]).toBeCloseTo(sd, 3);
      expect(run.mean.data[5 * W + 10]).toBeCloseTo(mean, 3);
      // Still ground shows only the sensor noise.
      expect(run.deviation.data[20 * W + 40]!).toBeLessThan(0.35);
    }
    expect(closed[0]!.mean.data[20 * W + 40]).toBeCloseTo(scenes[0]![20 * W + 40]!, 0);
  });

  it('reports nothing for a recording without still runs', () => {
    const grouper = new StillRunGrouper(W, H, { minFrames: 6 });
    for (let s = 0; s < 5; s++) expect(grouper.push(frame(ground(20 + s), s, 0)).closed).toBeNull();
    expect(grouper.finish()).toBeNull();
    expect(grouper.distinct).toBe(5);
  });
});
