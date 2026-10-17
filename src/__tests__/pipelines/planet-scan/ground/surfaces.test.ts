import { describe, expect, it } from 'vitest';
import { GRASS, SAND, SEA } from '../../../../pipelines/planet-scan/ground/color';
import { nameSurfaces, readRegions, surfaceVotes, type SurfaceRaster } from '../../../../pipelines/planet-scan/ground/surfaces';

// A planet laid out by hand at four pixels a cell: unseen round the scan, deep sea, shallows, a sand
// rim, grass with star decals, an inland pond in the shallows' colour and a deck out at sea.
const N = 120;
const DEEP = 0, SHALLOWS = 1, RIM = 2, LAWN = 3, STARS = 4, DECK = 5;

function layout(): Int16Array {
  const label = new Int16Array(N * N).fill(-1);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = Math.max(Math.abs(x - 60), Math.abs(y - 60));
      if (r >= 56) continue;
      let c = r < 28 ? LAWN : r < 34 ? RIM : r < 42 ? SHALLOWS : DEEP;
      if (c === LAWN && x % 8 < 2 && y % 8 < 2) c = STARS;
      if (x >= 54 && x < 66 && y >= 54 && y < 66) c = SHALLOWS;
      if (x >= 10 && x < 18 && y >= 56 && y < 64) c = DECK;
      label[y * N + x] = c;
    }
  }
  return label;
}

/** The layout drawn in `colours` (one L*a*b* a cluster), with the centres the clusters take. */
function rasterOf(colours: readonly (readonly number[])[]): { raster: SurfaceRaster; centres: Float64Array } {
  const label = layout();
  const lab = new Float32Array(N * N * 3);
  for (let i = 0; i < N * N; i++) if (label[i]! >= 0) lab.set(colours[label[i]!]!, i * 3);
  return { raster: { w: N, h: N, label, lab, perCell: 16 }, centres: Float64Array.from(colours.flat()) };
}

const AS_DRAWN = [[42, -25, 4], [70, -42, 30], [83, 1, 45], [66, -45, 64], [82, -20, 76], [70, 6, 50]];
/** Another style: the grass in the sea's colour and the sea in the grass's, the sand dark. */
const RESTYLED = [[66, -45, 64], [80, -15, 70], [35, 5, -20], [42, -25, 4], [55, 30, -40], [30, 8, -18]];

describe('naming the palette by the ground it lies on', () => {
  it.each([['as drawn', AS_DRAWN], ['in another style', RESTYLED]])('names sea, sand and grass by where they lie, %s', (_name, colours) => {
    const { raster, centres } = rasterOf(colours);
    expect(Array.from(nameSurfaces(centres, raster))).toEqual([SEA, SEA, SAND, GRASS, GRASS, SAND]);
    // The pond is enclosed by the grass, so it lies on the grass, though its colour is the shallows'.
    const { surface } = readRegions(raster);
    expect(surface[60 * N + 60]).toBe(GRASS);
    expect(surface[60 * N + 4]).toBe(-1);
  });
});

describe('reading the ground by its regions', () => {
  // A wide stretch of lawn reaching the rim, lit into the shallows' colour, which one cluster holds
  // with the shallows, apart from them.
  const LIT = { x: 34, y: 33, w: 52, h: 9 };
  function litLayout(colours: readonly (readonly number[])[]): SurfaceRaster {
    const { raster } = rasterOf(colours);
    const label = Int16Array.from(raster.label);
    const lab = Float32Array.from(raster.lab);
    for (let y = LIT.y; y < LIT.y + LIT.h; y++) {
      for (let x = LIT.x; x < LIT.x + LIT.w; x++) {
        label[y * N + x] = SHALLOWS;
        lab.set(colours[SHALLOWS]!, (y * N + x) * 3);
      }
    }
    return { ...raster, label, lab };
  }

  it.each([['as drawn', AS_DRAWN], ['in another style', RESTYLED]])('reads one cluster as each surface it lies on, %s', (_name, colours) => {
    const raster = litLayout(colours);
    const { surface, look } = readRegions(raster);
    expect(surface[37 * N + 60]).toBe(GRASS);
    expect(surface[60 * N + 10]).toBe(SEA);
    // The shallows' colour reads as sea at sea and as the lawn it lies on there.
    expect(look[60 * N + 22]).toBe(SEA);
    expect(look[37 * N + 60]).toBe(GRASS);
    expect(look[45 * N + 60]).toBe(GRASS);
    expect(look[60 * N + 29]).toBe(SAND);
  });

  it('blends the votes across an edge by where the colour lies between its sides', () => {
    // Shallows at x < 16, sand beyond, with a ramp of colours between at x 16 to 23.
    const w = 40, h = 8;
    const label = new Int16Array(w * h);
    const lab = new Float32Array(w * h * 3);
    const [sea, sand] = [AS_DRAWN[SHALLOWS]!, AS_DRAWN[RIM]!];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = Math.min(1, Math.max(0, (x - 15.5) / 8));
        label[y * w + x] = t < 0.5 ? 0 : 1;
        lab.set(sea.map((v, q) => v + t * (sand[q]! - v)), (y * w + x) * 3);
      }
    }
    const look = Int8Array.from(label, (l) => (l === 0 ? SEA : SAND));
    const { sea: votes } = surfaceVotes({ w, h, label, lab, perCell: 16 }, { surface: look, look }, new Uint8Array(w * h).fill(1));
    expect(votes[4 * w + 2]).toBe(1);
    expect(votes[4 * w + 37]).toBe(0);
    expect(votes[4 * w + 19]).toBeGreaterThan(0.3);
    expect(votes[4 * w + 19]).toBeLessThan(0.7);
    expect(votes[4 * w + 18]).toBeGreaterThan(votes[4 * w + 20]!);
  });
});
