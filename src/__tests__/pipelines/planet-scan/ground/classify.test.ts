import { describe, expect, it } from 'vitest';
import { fitPalette } from '../../../../pipelines/planet-scan/ground/classify';
import { centresAt, GRASS, localPalette, nearestCentre, PaletteSampler, SAND, SEA, toLab } from '../../../../pipelines/planet-scan/ground/color';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import { COLOURS, islandScene, paintWorld, scanPositions, testLattice, viewTile } from './ground-synthetic';

const sceneOf = (() => {
  const lattice = testLattice(37.3, 81.9);
  const world = paintWorld(islandScene(), lattice);
  const { width: W, height: H } = SCAN_PROFILE.tile;
  const positions = scanPositions(world, W, H);
  return { tiles: positions.map((p, k) => viewTile(world, p, { width: W, height: H }, k)), positions, W, H };
})();

/** The island's palette, its tiles first recoloured by `recolour`, and the class of a colour. */
function paletteOf(recolour: (rgb: readonly number[]) => number[]) {
  const { tiles, positions, W, H } = sceneOf;
  const sampler = new PaletteSampler(W, H);
  tiles.forEach((t, k) => {
    const data = new Uint8ClampedArray(t.data.length);
    for (let p = 0; p < data.length; p += 4) data.set([...recolour([t.data[p]!, t.data[p + 1]!, t.data[p + 2]!]), 255], p);
    sampler.push({ width: W, height: H, data }, positions[k]!);
  });
  const palette = fitPalette(sampler);
  const lab = new Float64Array(3);
  const classOf = (rgb: readonly number[]) => {
    const [r, g, b] = recolour(rgb);
    toLab(r!, g!, b!, lab);
    return palette.classes[nearestCentre(lab, palette.centres, palette.classes.length)];
  };
  return { palette, classOf };
}

describe('the ground palette', () => {
  // The clusters are named by where they lie on the ground, so the island keeps its surfaces however
  // its colours are drawn: as painted, with the channels turned (grass blue, sea pink) and inverted.
  it.each([
    ['as painted', (c: readonly number[]) => [...c]],
    ['with its channels turned', (c: readonly number[]) => [c[2]!, c[0]!, c[1]!]],
    ['inverted', (c: readonly number[]) => c.map((v) => 255 - v)],
  ])('names the sea, the sand and the grass by where they lie, %s', (_name, recolour) => {
    const { classOf } = paletteOf(recolour);
    expect(classOf(COLOURS.sea)).toBe(SEA);
    expect(classOf(COLOURS.sand)).toBe(SAND);
    expect(classOf(COLOURS.grass)).toBe(GRASS);
  });

  it('is deterministic', () => {
    expect(paletteOf((c) => [...c]).palette).toEqual(paletteOf((c) => [...c]).palette);
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

describe('the local palette', () => {
  // Sand between grass and sea, its west half under a tint, read with one centre a class.
  const W = 40;
  const H = 20;
  const colours = { grass: [120, 175, 80], sand: [222, 205, 160], tinted: [210, 205, 190], sea: [70, 125, 215] };
  const labOf = (rgb: readonly number[]) => {
    const lab = new Float64Array(3);
    toLab(rgb[0]!, rgb[1]!, rgb[2]!, lab);
    return lab;
  };
  const centres = Float64Array.from([...labOf(colours.sea), ...labOf(colours.sand), ...labOf(colours.grass)]);
  const classes = Uint8Array.from([SEA, SAND, GRASS]);
  const region = SCAN_PROFILE.chunk.width * SCAN_PROFILE.ground.localPalette.regionChunks;
  const sampler = new PaletteSampler(W, H, 100_000, 4, 0);
  for (let j = 0; j < 40; j++) {
    for (let i = 0; i < Math.round((4 * region) / W); i++) {
      const c = j >= 28 ? colours.sea : j < 7 ? colours.grass : i * W < 2 * region ? colours.tinted : colours.sand;
      const data = new Uint8Array(W * H * 4);
      for (let p = 0; p < W * H; p++) data.set([c[0]!, c[1]!, c[2]!, 255], p * 4);
      sampler.push({ width: W, height: H, data }, { x: i * W, y: j * H });
    }
  }
  const local = localPalette(centres, classes, sampler);
  const here = (x: number) => {
    const out = new Float64Array(9);
    centresAt(local, x, 300, out);
    return out;
  };
  const distance = (a: ArrayLike<number>, b: ArrayLike<number>) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

  it('fits the sand to each region\'s own', () => {
    expect(distance(here(region / 2).subarray(3, 6), labOf(colours.tinted))).toBeLessThan(1);
    expect(distance(here(3.5 * region).subarray(3, 6), labOf(colours.sand))).toBeLessThan(1);
    expect(distance(labOf(colours.tinted), labOf(colours.sand))).toBeGreaterThan(10);
  });

  it('keeps the recording\'s sea and grass', () => {
    const west = here(region / 2);
    for (const c of [0, 2]) for (let q = 0; q < 3; q++) expect(west[c * 3 + q]).toBeCloseTo(centres[c * 3 + q]!, 9);
  });
});
