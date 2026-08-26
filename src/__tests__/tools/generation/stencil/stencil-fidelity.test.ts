/**
 * HOW WELL A SMALL REGION REPRODUCES A PICTURE, measured rather than argued.
 *
 * The harness reconstructs: a fixture is drawn at source resolution, read into a stencil at the cell
 * count a small region gives (20x20 to 40x40, the sizes reported as losing the shape), matched to a
 * palette, and the result compared back against the source's own area average per cell. The distance
 * is the mean over cells in a luma-weighted RGB space, 0 for a perfect reproduction and about 200 for
 * two unrelated pictures.
 *
 * TWO NUMBERS, because dithering is not meant to win per cell: a dithered cell is deliberately the
 * wrong colour so that its NEIGHBOURHOOD is the right one. So the per-cell distance is reported and
 * the 2x2-averaged one — the one the eye actually takes — is what the thresholds are set on.
 *
 * THE FIXTURES ARE OURS: three pieces of pixel art written as characters and a colour key
 * (`_stencil-art.ts`). Fixed shapes, fixed colours, no fetching and nothing borrowed.
 */
import { describe, it, expect } from 'vitest';
import { matchWithDiffusion, RAMP_DIFFUSION, stencilFromPixels, type SourcePixels } from '../../../../tools/generation/stencil/stencil-sample';
import { nearestByColor, nearestTerrain, terrainPalette, type Stencil } from '../../../../tools/generation/stencil/stencil';
import { FACE, HEART, LETTER, pixels, type Art } from './_stencil-art';

/**
 * POINT SAMPLING, the baseline the area-integrating reading is measured against: one source pixel per
 * destination quadrant, taken at its centre. It is what a canvas downscaling by a large factor does,
 * and at a small cell count it drops whole features of the picture.
 */
function pointSampled(src: SourcePixels, box: { width: number; height: number }): Stencil {
  const { width, height } = box;
  const qw = width * 2, qh = height * 2;
  const scale = Math.min(qw / src.width, qh / src.height);
  const offX = (qw - src.width * scale) / 2, offY = (qh - src.height * scale) / 2;
  const coverage = new Uint8Array(width * height);
  const color = new Uint32Array(width * height);
  const quad = new Uint8Array(width * height * 4);
  const QUAD = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let aSum = 0, r = 0, g = 0, b = 0;
      for (let c = 0; c < 4; c++) {
        const qx = x * 2 + QUAD[c]![0], qy = y * 2 + QUAD[c]![1];
        const sx = Math.floor((qx + 0.5 - offX) / scale), sy = Math.floor((qy + 0.5 - offY) / scale);
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
        const p = (sy * src.width + sx) * 4;
        const a = src.data[p + 3]! / 255;
        quad[i * 4 + c] = Math.round(a * 255);
        aSum += a;
        r += src.data[p]! * a; g += src.data[p + 1]! * a; b += src.data[p + 2]! * a;
      }
      coverage[i] = Math.round((aSum / 4) * 255);
      color[i] = aSum > 0 ? (((Math.round(r / aSum) << 16) | (Math.round(g / aSum) << 8) | Math.round(b / aSum)) >>> 0) : 0;
    }
  }
  return { width, height, coverage, color, quad };
}

/** What the picture TRULY is at this cell count: the area average of the source under each cell,
 *  asked for explicitly, since the sampler's own reading of a DRAWING is deliberately not that. */
function truth(src: SourcePixels, box: { width: number; height: number }): Stencil {
  return stencilFromPixels(src, box, { nature: 'photographic', background: false })!;
}

/**
 * The reading these cases are about: integrate the area, keep the whole footprint.
 *
 * ASKED FOR EXPLICITLY, because it is one of the two the sampler chooses between and this file
 * measures it against POINT sampling — the reduction, and nothing else. A drawing is read by
 * majority in production and a backdrop is dropped from it, and both of those change the answer in
 * ways that are meaningless against an area-average truth (a majority reading is deliberately not
 * the mean). What they do to the map is measured where it can be: `stencil-image.test.ts`.
 */
function sampled(src: SourcePixels, box: { width: number; height: number }): Stencil {
  return stencilFromPixels(src, box, { nature: 'photographic', background: false })!;
}

const dist = (a: number, b: number): number => {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
};

/** Mean distance between a reconstruction and the truth, over the cells the picture covers. `blur`
 *  averages both sides over a square first, which is how a dithered area is actually read. */
function reconstructionDistance(got: number[], want: Stencil, blur: number): number {
  const { width: w, height: h, coverage } = want;
  const box = (src: (i: number) => number, x: number, y: number): number => {
    let n = 0, r = 0, g = 0, b = 0;
    for (let dy = 0; dy < blur; dy++) {
      for (let dx = 0; dx < blur; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= w || ny >= h || coverage[ny * w + nx]! < 128) continue;
        const rgb = src(ny * w + nx);
        r += (rgb >> 16) & 0xff; g += (rgb >> 8) & 0xff; b += rgb & 0xff; n++;
      }
    }
    if (n === 0) return -1;
    return ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)) >>> 0;
  };
  let total = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (coverage[y * w + x]! < 128) continue;
      const a = box((i) => got[i] ?? 0, x, y);
      const b = box((i) => want.color[i] ?? 0, x, y);
      if (a < 0 || b < 0) continue;
      total += dist(a, b); n++;
    }
  }
  return n === 0 ? 0 : total / n;
}

/** A palette with a real spread of hues, standing in for the item catalogue: the colours a picture
 *  can actually be built from. Fixed here so the numbers below mean the sampler, not the catalog. */
const ITEMS = [
  0xffffff, 0xdcd7c9, 0xa8a29a, 0x555049, 0x201c18,
  0xd44a5a, 0xf2a0b4, 0x8d2a3a, 0xf5c542, 0xe08a2c,
  0x35538f, 0x86b0e8, 0x2f7d55, 0x93cf7e, 0x7b5133,
].map((rgb) => ({ catalogId: `x${rgb}`, rgb }));

/** Match a stencil to a palette, with or without diffusion, and return the colour each cell draws. */
function reproduce(stencil: Stencil, palette: readonly { rgb: number }[], diffuse: boolean): number[] {
  const wanted = (i: number): number | null =>
    (stencil.coverage[i] ?? 0) < 128 ? null : (stencil.color[i] ?? 0);
  if (diffuse) {
    return matchWithDiffusion(stencil, wanted, (rgb) => nearestByColor(palette, rgb), (e) => e.rgb)
      .map((e) => e?.rgb ?? 0);
  }
  const out: number[] = new Array(stencil.width * stencil.height).fill(0);
  for (let i = 0; i < out.length; i++) {
    const want = wanted(i);
    if (want === null) continue;
    out[i] = nearestByColor(palette, want)?.rgb ?? 0;
  }
  return out;
}

const FIXTURES: readonly [string, Art][] = [['heart', HEART], ['face', FACE], ['letter', LETTER]];
const SIZES = [20, 28, 40];

/** The committed thresholds, in the distance units above: no fixture at any size is worse than the
 *  first, and reading by area with diffusion is better than point-sampling and rounding by at least
 *  the second, as a ratio of the means. Measured 6.5 to 9.6 against 9.5 to 11.7 when they were set. */
const WORST_AREA = 10.5;
const GAIN = 1.25;

describe('a small region reproduces a picture', () => {
  it('reads by area rather than by point, and the reconstruction says so', () => {
    const report: string[] = [];
    let worstArea = 0, areaTotal = 0, pointTotal = 0;
    for (const [name, art] of FIXTURES) {
      for (const side of SIZES) {
        const src = pixels(art, 6);
        const box = { width: side, height: side };
        const want = truth(src, box);
        const area = reconstructionDistance(reproduce(sampled(src, box), ITEMS, true), want, 2);
        const point = reconstructionDistance(reproduce(pointSampled(src, box), ITEMS, false), want, 2);
        report.push(`${name}@${side}: area+dither ${area.toFixed(1)} vs point+nearest ${point.toFixed(1)}`);
        expect(area).toBeLessThan(point);
        worstArea = Math.max(worstArea, area);
        areaTotal += area; pointTotal += point;
      }
    }
    expect(worstArea).toBeLessThan(WORST_AREA);
    expect(pointTotal / areaTotal).toBeGreaterThan(GAIN);
    expect(report).toHaveLength(FIXTURES.length * SIZES.length);
  });

  it('keeps the features a point sample drops', () => {
    // The face's eyes are two dark pixels of sixteen. Point-sampled at 20 cells they land between
    // samples and can vanish outright; integrated, every cell they touch darkens.
    const src = pixels(FACE, 6);
    const box = { width: 20, height: 20 };
    const darkCells = (s: Stencil): number =>
      [...s.color].filter((rgb, i) => (s.coverage[i] ?? 0) >= 128 && ((rgb >> 16) & 0xff) < 120).length;
    expect(darkCells(sampled(src, box))).toBeGreaterThan(darkCells(pointSampled(src, box)));
  });

  it('spends the error on the neighbours, so an area reads as the colour it was', () => {
    // A flat colour sitting between two palette entries: undithered every cell is the same wrong
    // colour, dithered the mix averages back to what the picture had.
    const side = 24;
    const stencil: Stencil = {
      width: side, height: side,
      coverage: new Uint8Array(side * side).fill(255),
      color: new Uint32Array(side * side).fill(0x808080),
    };
    const palette = [{ rgb: 0x404040 }, { rgb: 0xc0c0c0 }];
    const flat = reproduce(stencil, palette, false);
    const mixed = reproduce(stencil, palette, true);
    const mean = (out: number[]): number => out.reduce((sum, rgb) => sum + ((rgb >> 16) & 0xff), 0) / out.length;
    expect(Math.abs(mean(mixed) - 0x80)).toBeLessThan(Math.abs(mean(flat) - 0x80));
    expect(Math.abs(mean(mixed) - 0x80)).toBeLessThan(12);
  });

  it('is deterministic, twice over the same picture', () => {
    const src = pixels(HEART, 5);
    const box = { width: 22, height: 22 };
    const once = reproduce(sampled(src, box), ITEMS, true);
    const twice = reproduce(sampled(src, box), ITEMS, true);
    expect(once).toEqual(twice);
  });

  it('leaves the cells the picture does not reach uncovered', () => {
    const src = pixels(HEART, 4);
    // A wide box: the picture is fitted to the shorter side and centred, so whole columns are empty.
    const s = sampled(src, { width: 40, height: 12 });
    expect(s.coverage[0]).toBe(0);
    expect([...s.coverage].some((c) => c >= 128)).toBe(true);
  });

  it('carries the terrain ramp too, which is a far narrower palette', () => {
    const src = pixels(LETTER, 6);
    const box = { width: 24, height: 24 };
    const ramp = terrainPalette(8, true);
    const want = truth(src, box);
    const stencil = sampled(src, box);
    const dithered = matchWithDiffusion(
      stencil,
      (i) => ((stencil.coverage[i] ?? 0) < 128 ? null : (stencil.color[i] ?? 0)),
      (rgb) => nearestTerrain(ramp, rgb),
      (e) => e.rgb,
      RAMP_DIFFUSION,
    ).map((e) => e?.rgb ?? 0);
    const plain = [...stencil.color].map((rgb, i) => ((stencil.coverage[i] ?? 0) < 128 ? 0 : nearestTerrain(ramp, rgb).rgb));
    // Nine colours cannot hold a blue letter, so both are far off; the diffusion still gets closer.
    expect(reconstructionDistance(dithered, want, 3)).toBeLessThan(reconstructionDistance(plain, want, 3));
  });
});
