import type { RoadSurfaceGrain } from '../../../config/catalog/road-material';

/** Periodic value noise keeps independently rasterized repeats seamless. */
export function periodicGrain(frequency: number, seed: number): (x: number, y: number) => number {
  const grid = new Float32Array(frequency * frequency);
  for (let i = 0; i < grid.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    grid[i] = (seed >>> 0) / 0xffffffff - .5;
  }
  const wrap = (v: number) => ((v % frequency) + frequency) % frequency;
  const smooth = (v: number) => v * v * (3 - 2 * v);
  return (x, y) => {
    const px = x * frequency, py = y * frequency, ix = Math.floor(px), iy = Math.floor(py);
    const u = smooth(px - ix), v = smooth(py - iy);
    const a = grid[wrap(iy) * frequency + wrap(ix)]!;
    const b = grid[wrap(iy) * frequency + wrap(ix + 1)]!;
    const c = grid[wrap(iy + 1) * frequency + wrap(ix)]!;
    const d = grid[wrap(iy + 1) * frequency + wrap(ix + 1)]!;
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
}

/** Broad mineral clouds and fine grain modulate pigment, never transparency or the pattern phase. */
export function applySurfaceGrain(ctx: CanvasRenderingContext2D, size: number, detail: RoadSurfaceGrain): void {
  const pixels = ctx.getImageData(0, 0, size, size);
  const coarse = periodicGrain(7, 0x7592ab), middle = periodicGrain(23, 0x361ba7);
  let seed = 0x4c31ea;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (!pixels.data[i + 3]) continue;
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const grit = (seed >>> 0) / 0xffffffff - .5;
    const clouds = coarse(x / size, y / size) * .7 + middle(x / size, y / size) * .3;
    const change = clouds * detail.clouds + grit * detail.grain;
    for (let channel = 0; channel < 3; channel++) {
      const value = pixels.data[i + channel]!;
      pixels.data[i + channel] = value + change * (change > 0 ? 255 - value : value);
    }
  }
  ctx.putImageData(pixels, 0, 0);
}
