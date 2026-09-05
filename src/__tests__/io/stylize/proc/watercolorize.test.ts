// The structure-blind pass: deterministic in the seed, lightens a flat mid tone toward paper, and
// deepens tone along colour boundaries — the dried rim, in image space.
import { describe, it, expect } from 'vitest';
import { watercolorize, type Bitmap } from '../../../../io/stylize/proc/watercolorize';

function flatHalves(w: number, h: number): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const g = x < w / 2 ? 110 : 200;
    data[i] = g; data[i + 1] = g; data[i + 2] = g; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe('watercolorize', () => {
  it('is deterministic in the seed', () => {
    const a = flatHalves(64, 64), b = flatHalves(64, 64);
    watercolorize(a, { seed: 7 });
    watercolorize(b, { seed: 7 });
    expect(Array.from(a.data.slice(0, 400))).toEqual(Array.from(b.data.slice(0, 400)));
    const c = flatHalves(64, 64);
    watercolorize(c, { seed: 8 });
    expect(Array.from(c.data)).not.toEqual(Array.from(a.data));
  });

  it('lifts a mid tone toward paper away from edges and deepens it along the boundary', () => {
    const img = flatHalves(64, 64);
    watercolorize(img, { seed: 7 });
    const at = (x: number, y: number) => img.data[(y * 64 + x) * 4]!;
    // deep interior of the dark half: lifted above its source value
    let interior = 0, edge = 0;
    for (let y = 20; y < 44; y++) { interior += at(8, y); edge += at(30, y); }
    interior /= 24; edge /= 24;
    expect(interior).toBeGreaterThan(110);
    // along the boundary the rim deepens below the lifted interior
    expect(edge).toBeLessThan(interior);
  });
});
