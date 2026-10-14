import { describe, expect, it } from 'vitest';
import { fitPalette, paletteLookup } from '../../../../pipelines/planet-scan/ground/classify';
import { GRASS, lutIndex, PaletteSampler, SAND, SEA, toLab } from '../../../../pipelines/planet-scan/ground/color';
import { rng } from '../synthetic';

function samples(colours: readonly (readonly number[])[], count: number): Float32Array {
  const r = rng(5);
  const out = new Float32Array(count * 3);
  const lab = new Float64Array(3);
  const jitter = (v: number) => Math.max(0, Math.min(255, Math.round(v + (r() - 0.5) * 10)));
  for (let i = 0; i < count; i++) {
    const c = colours[i % colours.length]!;
    toLab(jitter(c[0]!), jitter(c[1]!), jitter(c[2]!), lab);
    out.set(lab, i * 3);
  }
  return out;
}

describe('the ground palette', () => {
  const sea = [70, 125, 215];
  const sand = [222, 205, 160];
  const grass = [120, 175, 80];
  const s = samples([sea, sea, sand, grass, grass, [60, 110, 190], [210, 190, 150]], 7000);

  it('classes sea by hue and splits sand from grass at the land hue threshold', () => {
    const lut = paletteLookup(fitPalette(s));
    expect(lut[lutIndex(70, 125, 215)]).toBe(SEA);
    expect(lut[lutIndex(222, 205, 160)]).toBe(SAND);
    expect(lut[lutIndex(120, 175, 80)]).toBe(GRASS);
  });

  it('is deterministic', () => {
    expect(fitPalette(s)).toEqual(fitPalette(s));
  });
});

describe('the palette sampler', () => {
  const W = 40;
  const H = 20;
  const tile = (rgb: readonly number[]) => {
    const data = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], i * 4);
    return { width: W, height: H, data };
  };
  const lightnessOf = (s: Float32Array) => Array.from({ length: s.length / 3 }, (_, i) => Math.round(s[i * 3]!));

  it('counts each place on the ground once however often the camera saw it', () => {
    const sampler = new PaletteSampler(W, H, 10_000, 4, 0);
    const dark = tile([40, 40, 40]);
    for (let k = 0; k < 30; k++) sampler.push(dark, { x: 0, y: 0 });
    sampler.push(tile([220, 220, 220]), { x: 400, y: 0 });
    const l = lightnessOf(sampler.samples());
    const darkBins = l.filter((v) => v < 50).length;
    expect(darkBins).toBe((W / 4) * (H / 4));
    expect(l.length - darkBins).toBe(darkBins);
  });

  it('averages the frames over a bin by their position weight', () => {
    const sampler = new PaletteSampler(W, H, 10_000, 4, 0);
    sampler.push(tile([100, 100, 100]), { x: 0, y: 0 });
    sampler.push(tile([200, 200, 200]), { x: 0, y: 0 });
    const lab = new Float64Array(3);
    toLab(150, 150, 150, lab);
    for (const v of lightnessOf(sampler.samples())) expect(v).toBe(Math.round(lab[0]!));
  });

  it('leaves out the bins the views saw too little of', () => {
    // A bin's weight is the sum of its position weights; the tile's corners weigh far less than 0.2
    // after one view, its centre about 1.
    const sampler = new PaletteSampler(W, H, 10_000, 4, 0.2);
    sampler.push(tile([90, 90, 90]), { x: 0, y: 0 });
    const once = sampler.samples().length / 3;
    expect(once).toBeGreaterThan(0);
    expect(once).toBeLessThan((W / 4) * (H / 4));
    for (let k = 0; k < 40; k++) sampler.push(tile([90, 90, 90]), { x: 0, y: 0 });
    expect(sampler.samples().length / 3).toBeGreaterThan(once);
  });

  it('places tiles on one bin grid at any offset and keeps at most its capacity', () => {
    const sampler = new PaletteSampler(W, H, 20, 4, 0);
    sampler.push(tile([90, 90, 90]), { x: -37.4, y: 13.6 });
    sampler.push(tile([90, 90, 90]), { x: 2.6, y: 13.6 });
    const s = sampler.samples();
    expect(s.length / 3).toBeLessThanOrEqual(20);
    expect(s.length / 3).toBeGreaterThan(10);
  });
});
