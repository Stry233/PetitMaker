import type { RoadSurfaceGrain } from '../../../config/catalog/road-material';
import { makeRng } from '../../../core/base/rng';
import { smoothLattice } from '../../../core/base/noise';

/** Periodic value noise keeps independently rasterized repeats seamless. */
export function periodicGrain(frequency: number, seed: number): (x: number, y: number) => number {
  const rng = makeRng(seed);
  const grid = Float32Array.from({ length: frequency * frequency }, () => rng.float() - .5);
  const wrap = (v: number) => ((v % frequency) + frequency) % frequency;
  const at = (ix: number, iy: number): number => grid[wrap(iy) * frequency + wrap(ix)]!;
  return (x, y) => smoothLattice(at, x * frequency, y * frequency);
}

/** Broad mineral clouds and fine grain modulate pigment, never transparency or the pattern phase. */
export function applySurfaceGrain(ctx: CanvasRenderingContext2D, size: number, detail: RoadSurfaceGrain): void {
  const pixels = ctx.getImageData(0, 0, size, size);
  const coarse = periodicGrain(7, 0x7592ab), middle = periodicGrain(23, 0x361ba7);
  const rng = makeRng(0x4c31ea);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (!pixels.data[i + 3]) continue;
    const grit = rng.float() - .5;
    const clouds = coarse(x / size, y / size) * .7 + middle(x / size, y / size) * .3;
    const change = clouds * detail.clouds + grit * detail.grain;
    for (let channel = 0; channel < 3; channel++) {
      const value = pixels.data[i + channel]!;
      pixels.data[i + channel] = value + change * (change > 0 ? 255 - value : value);
    }
  }
  ctx.putImageData(pixels, 0, 0);
}
