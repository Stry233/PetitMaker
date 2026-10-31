/**
 * A picture built small is still the picture.
 *
 *  1. The terrain ramp runs from luma 184 at layer 1 to 79 at layer 8 and pastel art lives above 200,
 *     so matched raw it would all take layer 1. The picture's tonal range is fitted onto the palette's
 *     before matching.
 *  2. A JPEG has no alpha, so a white backdrop would match a colour and pave the region over the
 *     silhouette. A flat backdrop is keyed out at source resolution.
 *
 * A drawing's colours are already a palette, so its cells take their majority colour rather than an
 * average, and its edges are not diffused into speckle.
 */
import { describe, it, expect } from 'vitest';
import {
  readSourceNature, sampleStencil, stencilFromPixels, type SampleOptions, type SourcePixels,
} from '../../../../tools/generation/stencil/stencil-sample';
import { backgroundMask } from '../../../../tools/generation/stencil/stencil-backdrop';
import { cropPixels, salientCrop } from '../../../../tools/generation/stencil/stencil-crop';
import {
  fitTarget, narrowRange, paletteToneRange, sourceToneRange, toneFit,
} from '../../../../tools/generation/stencil/stencil';
import { luma } from '../../../../tools/generation/stencil/color';
import { TerrainType } from '../../../../core/model/types';
import { type StencilWaterRole } from '../../../../tools/generation/recipe';
import { FACE, HEART, LETTER, photograph, pixels } from './_stencil-art';
import {
  RAMP, SIZES, backdropCells, pictureTruth, runImage, scoreImage,
} from './_stencil-image';

/** The trim the product's sampling takes of `src` for `box`, or null where it takes none. */
const buildingCrop = (src: SourcePixels, box: { width: number; height: number }, opts: SampleOptions): NonNullable<ReturnType<typeof sampleStencil>>['trim'] =>
  sampleStencil(src, box, opts)?.trim ?? null;


/** A palette with a spread of hues from white to near-black, like the item catalogue, so a picture
 *  needs no tone fitting against it. */
const ITEMS = [
  0xffffff, 0xdcd7c9, 0xa8a29a, 0x555049, 0x201c18,
  0xd44a5a, 0xf2a0b4, 0x8d2a3a, 0xf5c542, 0xe08a2c,
  0x35538f, 0x86b0e8, 0x2f7d55, 0x93cf7e, 0x7b5133,
].map((rgb) => ({ catalogId: `x${rgb}`, rgb }));

/** Every cell the stencil claims, as packed colours. */
const claimed = (s: { coverage: Uint8Array; color: Uint32Array }): number[] =>
  [...s.color].filter((_, i) => (s.coverage[i] ?? 0) >= 128);

describe('what kind of picture this is', () => {
  it('reads our pixel art as a drawing and a continuous tone as a photograph', () => {
    for (const art of [HEART, FACE, LETTER]) {
      const reading = readSourceNature(pixels(art, 6));
      expect(reading.nature).toBe('flat');
      expect(reading.flatShare).toBeGreaterThan(0.9);
    }
    const photo = readSourceNature(photograph(128));
    expect(photo.nature).toBe('photographic');
    expect(photo.flatShare).toBeLessThan(0.2);
  });

  it('judges only the pixels the picture draws, so a transparent field cannot vote', () => {
    // `HEART` is a shape on transparent ground; an alpha-blind count would drift toward one colour.
    const small = pixels(HEART, 4);
    const padded: SourcePixels = { data: new Uint8Array(200 * 200 * 4), width: 200, height: 200 };
    for (let y = 0; y < small.height; y++) {
      for (let x = 0; x < small.width; x++) {
        const from = (y * small.width + x) * 4, to = ((y + 60) * 200 + x + 60) * 4;
        for (let c = 0; c < 4; c++) padded.data[to + c] = small.data[from + c]!;
      }
    }
    expect(readSourceNature(padded).flatShare).toBeCloseTo(readSourceNature(small).flatShare, 5);
  });

  it('is recorded on the stencil, which is what the readers switch on', () => {
    expect(stencilFromPixels(pixels(HEART, 6), { width: 20, height: 20 })!.nature).toBe('flat');
    expect(stencilFromPixels(photograph(128), { width: 20, height: 20 })!.nature).toBe('photographic');
  });
});

describe('a drawing is read by majority, a photograph by area', () => {
  it('gives a cell one of the picture\'s own colours rather than a blend of two', () => {
    // `LETTER` is exactly four colours; an area reading invents shades between them at its edges.
    const src = pixels(LETTER, 6);
    const own = new Set(Object.values(LETTER.key));
    const majority = claimed(stencilFromPixels(src, { width: 20, height: 20 }, { background: false })!);
    const area = claimed(stencilFromPixels(src, { width: 20, height: 20 }, { nature: 'photographic', background: false })!);
    const invented = (cells: number[]): number => cells.filter((rgb) => !own.has(rgb)).length;
    expect(invented(majority)).toBe(0);
    expect(invented(area)).toBeGreaterThan(0);
  });

  it('gives one flat colour one entry, whichever kind of picture it is called', () => {
    // A grey far from every palette entry still comes back as one entry, or a face in one skin tone
    // would arrive dithered. A small box judges flatness per region (`stencil-areas.ts:regionFlatness`),
    // not by the picture's label.
    const side = 96;
    const flat: SourcePixels = { data: new Uint8Array(side * side * 4), width: side, height: side };
    for (let i = 0; i < side * side; i++) {
      flat.data[i * 4] = 0xa0; flat.data[i * 4 + 1] = 0xa0; flat.data[i * 4 + 2] = 0xa0; flat.data[i * 4 + 3] = 255;
    }
    const entries = (nature: 'flat' | 'photographic'): number =>
      new Set(runImage(flat, { side: 24, sample: { nature, background: false } }).built).size;
    expect(entries('flat')).toBe(1);
    expect(entries('photographic')).toBe(1);
  });
});

/** An opaque square of one colour with a second wherever `ink` says, like a path tile. */
function field(side: number, background: number, ink: (x: number, y: number) => boolean, inkColor = 0): SourcePixels {
  const data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const rgb = ink(x, y) ? inkColor : background;
      const i = (y * side + x) * 4;
      data[i] = (rgb >> 16) & 0xff; data[i + 1] = (rgb >> 8) & 0xff; data[i + 2] = rgb & 0xff; data[i + 3] = 255;
    }
  }
  return { data, width: side, height: side };
}

describe('a flat backdrop is not part of the picture', () => {
  it('keys out an opaque field and keeps a subject drawn in the same colour', () => {
    // A white backdrop, a black outline, white inside it. Keying at cell resolution would lose the
    // inside, since a one-cell outline does not seal.
    const side = 120;
    const src: SourcePixels = { data: new Uint8Array(side * side * 4), width: side, height: side };
    const put = (x: number, y: number, v: number): void => {
      const i = (y * side + x) * 4;
      src.data[i] = v; src.data[i + 1] = v; src.data[i + 2] = v; src.data[i + 3] = 255;
    };
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const inRing = x >= 30 && x < 90 && y >= 30 && y < 90;
        const inCore = x >= 36 && x < 84 && y >= 36 && y < 84;
        put(x, y, inRing && !inCore ? 0x10 : 0xff);
      }
    }
    const mask = backgroundMask(src)!;
    expect(mask).not.toBeNull();
    expect(mask[0]).toBe(1);                                   // the corner
    expect(mask[(60 * side) + 60]).toBe(0);                    // the white core
    expect(mask[(60 * side) + 32]).toBe(0);                    // the outline

    // Without the auto-trim, which would drop the keyed field and put the ring in the corner cell.
    const stencil = stencilFromPixels(src, { width: 24, height: 24 }, { trim: false })!;
    expect(stencil.coverage[0]).toBe(0);
    expect(stencil.coverage[12 * 24 + 12]).toBeGreaterThanOrEqual(128);
  });

  it('leaves a picture with no backdrop alone', () => {
    expect(backgroundMask(photograph(128))).toBeNull();          // no uniform border
    expect(backgroundMask(pixels(HEART, 6))).toBeNull();         // transparent already
  });

  it('does not mistake a drawn RIM for one', () => {
    // `FACE` is ringed in one orange that touches every edge and is a sixth of the picture, but is
    // not deep.
    expect(backgroundMask(pixels(FACE, 6))).toBeNull();
    const built = runImage(pixels(FACE, 6), { side: 24 });
    const rim = built.stencil;
    expect([...rim.coverage].filter((c) => c >= 128).length)
      .toBe([...stencilFromPixels(pixels(FACE, 6), { width: 24, height: 24 }, { background: false })!.coverage]
        .filter((c) => c >= 128).length);
  });

  it('is not a backdrop when it leaves no subject', () => {
    // A flat tile, one colour edge to edge like a path surface, passes every field gate; keying it
    // would leave nothing.
    expect(backgroundMask(field(128, 0xd9c9a8, () => false))).toBeNull();

    // Mortar lines survive the flood as hairlines, which are not a subject either.
    const lines = (x: number, y: number): boolean => x % 16 === 0 || y % 16 === 0;
    expect(backgroundMask(field(128, 0xd9c9a8, lines, 0x6b4a2a))).toBeNull();

    for (const tile of [field(128, 0xd9c9a8, () => false), field(128, 0xd9c9a8, lines, 0x6b4a2a)]) {
      const stencil = stencilFromPixels(tile, { width: 24, height: 24 })!;
      expect([...stencil.coverage].filter((c) => c >= 128).length).toBeGreaterThan(500);
    }
  });

  it('still keys a field that has a subject standing in it', () => {
    // The control: a subject thick enough to survive the erosion.
    const block = (x: number, y: number): boolean => x >= 44 && x < 84 && y >= 44 && y < 84;
    const mask = backgroundMask(field(128, 0xd9c9a8, block, 0x304050));
    expect(mask).not.toBeNull();
    expect(mask![0]).toBe(1);
    expect(mask![64 * 128 + 64]).toBe(0);
  });

  it('wants depth, and says so in the same units at any resolution', () => {
    // Depth is a share of the side, so two scales of one drawing are judged alike.
    expect(backgroundMask(pixels(FACE, 3))).toBeNull();
    expect(backgroundMask(pixels(FACE, 12))).toBeNull();
  });
});

/** Border rows and columns that build nothing (a keyed white sheet around a sticker) are dropped and
 *  the rest is fitted again, so the region is spent on what the picture builds. */
describe('a picture is fitted by what it builds', () => {
  /** A solid square inset `inset` pixels in a transparent field. */
  const inField = (px: number, inset: number): SourcePixels => {
    const data = new Uint8Array(px * px * 4);
    for (let y = inset; y < px - inset; y++) {
      for (let x = inset; x < px - inset; x++) {
        const i = (y * px + x) * 4;
        data[i] = 0x70; data[i + 1] = 0x90; data[i + 2] = 0x60; data[i + 3] = 255;
      }
    }
    return { data, width: px, height: px };
  };

  const claimedCells = (s: { coverage: Uint8Array }): number =>
    [...s.coverage].filter((c) => c >= 128).length;

  it('drops the border that builds nothing and fits the rest, to the pixel', () => {
    const src = inField(100, 30);
    const box = { width: 20, height: 20 };
    expect(buildingCrop(src, box, {})).toEqual({ x: 30, y: 30, width: 40, height: 40 });
    // Untrimmed, the subject is a sixth of the region; trimmed, all of it.
    expect(claimedCells(stencilFromPixels(src, box, { trim: false })!)).toBeLessThan(80);
    expect(claimedCells(stencilFromPixels(src, box, {})!)).toBe(400);
  });

  it('never reaches into the picture, however little of the middle builds', () => {
    // A thick ring's empty inside is not a border, so the crop stops at the ring's bounds.
    const px = 100;
    const data = new Uint8Array(px * px * 4);
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const ring = x >= 20 && x < 80 && y >= 20 && y < 80 && !(x >= 32 && x < 68 && y >= 32 && y < 68);
        if (!ring) continue;
        const i = (y * px + x) * 4;
        data[i] = 0x40; data[i + 1] = 0x50; data[i + 2] = 0x30; data[i + 3] = 255;
      }
    }
    const src: SourcePixels = { data, width: px, height: px };
    const box = { width: 24, height: 24 };
    expect(buildingCrop(src, box, {})).toEqual({ x: 20, y: 20, width: 60, height: 60 });
    const stencil = stencilFromPixels(src, box, {})!;
    expect(stencil.coverage[12 * 24 + 12]).toBeLessThan(128);     // the hole
    expect(stencil.coverage[0]).toBeGreaterThanOrEqual(128);      // the ring reaches the frame
  });

  it('leaves a picture that builds nothing exactly as it was', () => {
    // The run reports that it lays nothing; cropping to an empty rectangle would hide that.
    const empty: SourcePixels = { data: new Uint8Array(64 * 64 * 4), width: 64, height: 64 };
    expect(buildingCrop(empty, { width: 20, height: 20 }, {})).toBeNull();
    expect(claimedCells(stencilFromPixels(empty, { width: 20, height: 20 }, {})!)).toBe(0);
  });

  it('trims nothing from a picture that fills its own frame', () => {
    // A photograph has no keyed backdrop and no transparency, so every border cell builds.
    expect(buildingCrop(photograph(128), { width: 24, height: 24 }, {})).toBeNull();
    const run = runImage(photograph(128), { side: 24 });
    expect(run.trimmed).toBe(0);
    expect(run.built).toEqual(runImage(photograph(128), { side: 24, sample: { trim: false } }).built);
  });

  it('takes a rim only when the subject comes out meaningfully bigger', () => {
    // Two pixels around a hundred: re-fitting would shift every cell's phase for no visible gain.
    expect(buildingCrop(inField(100, 2), { width: 20, height: 20 }, {})).toBeNull();
  });

  it('is one answer per picture, box and reading, and asking it twice changes nothing', () => {
    const src = inField(100, 30);
    const box = { width: 20, height: 20 };
    const once = stencilFromPixels(src, box, {})!;
    expect([...once.coverage]).toEqual([...stencilFromPixels(src, box, {})!.coverage]);
    // The crop is a fixed point after one pass, so the preview and the build fit the same frame.
    const crop = buildingCrop(src, box, {})!;
    expect(buildingCrop(cropPixels(src, crop), box, {})).toBeNull();
  });

  it('asks the same question in every material, since a covered cell builds in all of them', () => {
    // No palette has an entry that lays nothing, so one trim serves every material.
    const src = inField(100, 30);
    const box = { width: 20, height: 20 };
    const mountain = runImage(src, { side: 20 });
    for (const run of [
      runImage(src, { side: 20, water: 'primary' }),
      runImage(src, { side: 20, water: 'palette' }),
      runImage(src, { side: 20, objects: ITEMS }),
    ]) {
      expect([...run.stencil.coverage]).toEqual([...mountain.stencil.coverage]);
    }
    expect(buildingCrop(src, box, {})).toEqual(buildingCrop(src, box, { nature: 'photographic' }));
  });
});

describe('the picture is fitted to what the palette can draw', () => {
  it('leaves a picture the palette already covers exactly where it is', () => {
    const wide = { lo: 20, hi: 250 };
    expect(fitTarget({ lo: 60, hi: 200 }, wide)).toEqual({ lo: 60, hi: 200 });
  });

  it('moves one it cannot into reach, keeping the picture\'s own span', () => {
    // Pastel art, brighter than the brightest green, comes down to the top of the ramp.
    const ramp = paletteToneRange(RAMP.map((rgb) => ({ rgb })));
    const moved = fitTarget({ lo: 200, hi: 255 }, ramp);
    expect(moved.hi).toBeCloseTo(ramp.hi, 5);
    expect(moved.hi - moved.lo).toBeCloseTo(55, 5);
  });

  it('squeezes one that is wider than the palette, and never magnifies a narrow one', () => {
    const ramp = paletteToneRange(RAMP.map((rgb) => ({ rgb })));
    expect(fitTarget({ lo: 0, hi: 255 }, ramp)).toEqual(ramp);
    // A single colour has no range, so it lands nearest its own tone, not mid-ramp.
    const one = fitTarget({ lo: 20, hi: 20 }, ramp);
    expect(one.lo).toBeCloseTo(ramp.lo, 5);
    expect(one.hi).toBeCloseTo(ramp.lo, 5);
  });

  it('lands the ends of the picture on the ends of the palette', () => {
    const from = { lo: 100, hi: 200 }, to = { lo: 79, hi: 184 };
    const fit = toneFit(from, to);
    expect(luma(fit(0x646464))).toBeCloseTo(79, 0);
    expect(luma(fit(0xc8c8c8))).toBeCloseTo(184, 0);
    expect(luma(fit(0x969696))).toBeGreaterThan(79);
    expect(luma(fit(0x969696))).toBeLessThan(184);
  });

  it('keeps the hue while it fits, and gives up only what it must', () => {
    const fit = toneFit({ lo: 0, hi: 255 }, { lo: 0, hi: 255 });
    const red = fit(0xd44a5a);
    expect((red >> 16) & 0xff).toBeGreaterThan((red >> 8) & 0xff);
    // Pushed to the top of a range, a saturated colour comes back paler, not clipped to another hue.
    const pale = toneFit({ lo: 0, hi: 255 }, { lo: 250, hi: 250 })(0xd44a5a);
    expect((pale >> 16) & 0xff).toBeGreaterThanOrEqual((pale >> 8) & 0xff);
    expect(luma(pale)).toBeCloseTo(250, 0);
  });

  it('is a no-op, byte for byte, when the palette already covers the picture', () => {
    // Mapping a range onto itself would still clamp outliers beyond the measured percentiles and round
    // each channel, so the colours below include extremes far outside the range.
    const same = { lo: 60, hi: 200 };
    const fit = toneFit(same, same);
    for (const rgb of [0x000000, 0xffffff, 0xd44a5a, 0x2f7d55, 0x010203]) expect(fit(rgb)).toBe(rgb);
  });

  it('leaves a range alone at contrast 1, so a fit can recognise that nothing was asked', () => {
    const range = { lo: 60, hi: 200 };
    expect(narrowRange(range, 1)).toBe(range);
    expect(fitTarget(range, { lo: 0, hi: 255 })).toBe(range);
  });

  it('narrows the window as contrast rises, which is what clips the ends', () => {
    const plain = narrowRange({ lo: 50, hi: 150 }, 1);
    const hard = narrowRange({ lo: 50, hi: 150 }, 2);
    expect(plain).toEqual({ lo: 50, hi: 150 });
    expect(hard.hi - hard.lo).toBeCloseTo(50, 5);
    expect((hard.lo + hard.hi) / 2).toBeCloseTo(100, 5);
  });

  it('measures the picture robustly, so one stray highlight cannot set the top', () => {
    const lumas = [...Array(200).fill(100), 255];
    expect(sourceToneRange(lumas).hi).toBeLessThan(255);
  });
});

describe('a picture built small carries the picture', () => {
  const cases = [['heart', HEART], ['face', FACE], ['letter', LETTER]] as const;

  it('reads on our own art at every size a small region gives', () => {
    for (const [name, art] of cases) {
      for (const side of SIZES) {
        const src = pixels(art, 6);
        const score = scoreImage(runImage(src, { side }), pictureTruth(src, side), RAMP, backdropCells(src, side));
        expect(score.violations, `${name}@${side}`).toBe(0);
        expect(score.fidelity, `${name}@${side}`).toBeGreaterThan(0.40);
        expect(score.spill, `${name}@${side}`).toBe(0);
      }
    }
  });

  it('carries a photograph too, which is the other half of the switch', () => {
    const src = photograph(128);
    const score = scoreImage(runImage(src, { side: 24 }), pictureTruth(src, 24), RAMP, []);
    expect(score.fidelity).toBeGreaterThan(0.6);
    expect(score.spread).toBeGreaterThan(0.8);
  });

  it('an image run is deterministic, twice over the same picture', () => {
    const src = pixels(FACE, 6);
    expect(runImage(src, { side: 22 }).built).toEqual(runImage(src, { side: 22 }).built);
  });

  it('builds a picture the palette covers exactly as it did before there was a fit', () => {
    // A catalogue from white to near-black already covers the picture, so the fit is an exact no-op.
    for (const [name, art] of cases) {
      for (const side of SIZES) {
        const src = pixels(art, 6);
        const fitted = runImage(src, { side, objects: ITEMS });
        const plain = runImage(src, { side, objects: ITEMS, fitTones: false });
        expect(fitted.built, `${name}@${side}`).toEqual(plain.built);
      }
    }
  });
});

/**
 * With the blue as one entry among eight greens a water picture gets almost no water; giving water
 * the whole region floods it. The picture stands in terrain with water inside it, and a cell it does
 * not cover stays the ground it was.
 */
describe('the material a picture is asked for is the material it gets', () => {
  const cases = [['heart', HEART], ['face', FACE], ['letter', LETTER]] as const;

  /** What stands on the picture's cells, its silhouette and the region around it after the run.
   *  `outsideBuilt` counts writes to region cells outside the picture's coverage. */
  function built(src: SourcePixels, side: number, water: StencilWaterRole): {
    covered: number; water: number; mountain: number;
    interior: number; interiorWater: number; edge: number; edgeWater: number;
    outsideBuilt: number; violations: number;
  } {
    const run = runImage(src, { side, water });
    const shown = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < side && y < side && (run.stencil.coverage[y * side + x] ?? 0) >= 128;
    let count = 0, blue = 0, green = 0, outsideBuilt = 0;
    let interior = 0, interiorWater = 0, edge = 0, edgeWater = 0;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const terrain = run.state.cells[run.origin.y + y]?.[run.origin.x + x]?.terrain;
        if (!shown(x, y)) {
          if (terrain) outsideBuilt++;
          continue;
        }
        count++;
        // Inside means every edge neighbour is covered; a cell off the box counts as covered, as in
        // the engine's silhouette test.
        const onEdge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx!, ny = y + dy!;
          return nx >= 0 && ny >= 0 && nx < side && ny < side && !shown(nx, ny);
        });
        if (onEdge) edge++; else interior++;
        if (!terrain) continue;
        if (terrain.type === TerrainType.Water) {
          blue++;
          if (onEdge) edgeWater++; else interiorWater++;
        } else green++;
      }
    }
    return {
      covered: count, water: blue, mountain: green,
      interior, interiorWater, edge, edgeWater,
      outsideBuilt, violations: run.violations,
    };
  }

  /** The art has light areas, so every case has real ponds with a figure standing around them. */
  it('sinks the picture\'s light and leaves the region around it as it was', () => {
    for (const [name, art] of cases) {
      for (const side of SIZES) {
        const b = built(pixels(art, 6), side, 'primary');
        expect(b.violations, `${name}@${side}`).toBe(0);
        expect(b.outsideBuilt, `${name}@${side}`).toBe(0);       // no flood
        // The water is the light the ramp cannot say, so every figure has some and is never only water.
        expect(b.water, `${name}@${side}`).toBeGreaterThan(0);
        expect(b.mountain, `${name}@${side}`).toBeGreaterThan(0);
        expect(b.water + b.mountain, `${name}@${side}`).toBe(b.covered);
      }
    }
    // A photograph, with blues of its own.
    const photo = built(photograph(128), 24, 'primary');
    expect(photo.water).toBeGreaterThan(0);
    expect(photo.outsideBuilt).toBe(0);
  });

  /** The silhouette is the bank: the outline stands in terrain all the way round, whatever its tone,
   *  or a pond reaching the edge would leave a hole where the shape should be. */
  it('never sinks the picture\'s own silhouette', () => {
    for (const [name, art] of cases) {
      for (const side of SIZES) {
        const b = built(pixels(art, 6), side, 'primary');
        expect(b.edge, `${name}@${side}`).toBeGreaterThan(0);
        expect(b.edgeWater, `${name}@${side}`).toBe(0);
        expect(b.interiorWater, `${name}@${side}`).toBe(b.water);
      }
    }
  });

  /** A comb of one-cell stripes is all silhouette, so nowhere is left for a pond. */
  it('builds a picture that is nothing but silhouette in terrain alone', () => {
    const comb = (px: number, period: number): SourcePixels => {
      const data = new Uint8Array(px * px * 4);
      for (let y = 0; y < px; y++) {
        for (let x = 0; x < px; x++) {
          const i = y * px + x;
          data[i * 4] = 0x8a; data[i * 4 + 1] = 0x9c; data[i * 4 + 2] = 0x74;
          data[i * 4 + 3] = x % period === 0 ? 255 : 0;
        }
      }
      return { data, width: px, height: px };
    };
    for (const side of [28, 40]) {
      const b = built(comb(40, 2), side, 'primary');
      expect(b.violations, `comb@${side}`).toBe(0);
      expect(b.water, `comb@${side}`).toBeLessThanOrEqual(b.interior);
      expect(b.outsideBuilt, `comb@${side}`).toBe(0);
    }
    // At forty the stripes land one cell wide, so the figure is edge and nothing else.
    const bare = built(comb(40, 2), 40, 'primary');
    expect(bare.interior).toBe(0);
    expect(bare.water).toBe(0);
    expect(bare.mountain).toBe(bare.covered);
  });

  /** Outlines are usually dark, so this subject is brightest at its edge: a tone reading alone would
   *  sink its border, and the bank has to come from the silhouette instead. */
  it('draws the silhouette even where the edge is the brightest part of the picture', () => {
    const px = 32, lo = 8, hi = 24;
    const data = new Uint8Array(px * px * 4);
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const i = y * px + x;
        const inside = x >= lo && x < hi && y >= lo && y < hi;
        const toEdge = Math.min(x - lo, hi - 1 - x, y - lo, hi - 1 - y);
        const v = inside ? Math.max(40, 240 - toEdge * 28) : 0;
        data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v;
        data[i * 4 + 3] = inside ? 255 : 0;
      }
    }
    // Untrimmed, since a trimmed subject fills the box and its only edge would be the region's.
    const run = runImage({ data, width: px, height: px }, { side: 24, water: 'primary', sample: { trim: false } });
    const at = (x: number, y: number): number | undefined =>
      run.state.cells[run.origin.y + y]?.[run.origin.x + x]?.terrain?.elevation;
    const isWater = (x: number, y: number): boolean =>
      run.state.cells[run.origin.y + y]?.[run.origin.x + x]?.terrain?.type === TerrainType.Water;
    // Every covered border cell is raised, not water.
    let border = 0, raised = 0;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const i = y * 24 + x;
        if ((run.stencil.coverage[i] ?? 0) < 128) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx!, ny = y + dy!;
          return nx >= 0 && ny >= 0 && nx < 24 && ny < 24 && (run.stencil.coverage[ny * 24 + nx] ?? 0) < 128;
        });
        if (!edge) continue;
        border++;
        if (!isWater(x, y) && (at(x, y) ?? 0) > 0) raised++;
      }
    }
    expect(border).toBeGreaterThan(8);
    expect(raised).toBe(border);
  });

  it('writes nothing outside a non-rectangular region, ground included', () => {
    const side = 24;
    // A diagonal half of the box, which no bounding rectangle can stand in for.
    const inRegion = (x: number, y: number): boolean => x + y < side;
    const run = runImage(pixels(FACE, 6), { side, water: 'primary', region: inRegion });
    let outside = 0, inside = 0;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const terrain = run.state.cells[run.origin.y + y]?.[run.origin.x + x]?.terrain;
        if (!terrain) continue;
        if (inRegion(x, y)) inside++; else outside++;
      }
    }
    expect(outside, 'nothing beyond the painted cells').toBe(0);
    expect(inside).toBeGreaterThan(0);
    expect(run.violations).toBe(0);
  });

  it('builds a picture of ONE colour as a lake inside its own bank', () => {
    // A subject with no tones gives a tone reading nothing to split, so the material decides.
    const flatArt: SourcePixels = { data: new Uint8Array(32 * 32 * 4), width: 32, height: 32 };
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const i = y * 32 + x;
        const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
        flatArt.data[i * 4] = 0x8a; flatArt.data[i * 4 + 1] = 0x9c; flatArt.data[i * 4 + 2] = 0x74;
        flatArt.data[i * 4 + 3] = inside ? 255 : 0;
      }
    }
    const b = built(flatArt, 20, 'primary');
    expect(b.mountain, 'the bank is drawn').toBe(b.edge);
    expect(b.water).toBe(b.interior);
    expect(b.water).toBeGreaterThan(b.mountain);
    expect(b.outsideBuilt).toBe(0);
  });

  it('builds a MOUNTAIN picture entirely out of mountain, with no water anywhere', () => {
    for (const [name, art] of cases) {
      for (const side of SIZES) {
        const b = built(pixels(art, 6), side, 'none');
        expect(b.violations, `${name}@${side}`).toBe(0);
        expect(b.water, `${name}@${side}`).toBe(0);
        expect(b.mountain, `${name}@${side}`).toBe(b.covered);
      }
    }
  });
});

/** The salient crop is an experiment: off unless asked for, and when asked it takes the part of the
 *  subject that carries it. Whether the crop is better is a judgement these tests do not make. */
describe('the salient crop is an experiment, and it is off', () => {
  it('changes nothing unless it is asked for', () => {
    const src = pixels(FACE, 6);
    const plain = stencilFromPixels(src, { width: 16, height: 16 })!;
    const asked = stencilFromPixels(src, { width: 16, height: 16 }, { crop: true })!;
    expect([...plain.color]).toEqual([...stencilFromPixels(src, { width: 16, height: 16 }, {})!.color]);
    expect([...asked.color]).not.toEqual([...plain.color]);
  });

  it('is absent above the size it exists for, asked or not', () => {
    const src = pixels(FACE, 6);
    const big = { width: 24, height: 24 };          // the crop is for boxes of twenty cells or fewer
    expect([...stencilFromPixels(src, big, { crop: true })!.color])
      .toEqual([...stencilFromPixels(src, big)!.color]);
  });

  it('takes the part of the subject the picture changes fastest over', () => {
    // A plain field with a marked patch in one corner.
    const side = 96;
    const src: SourcePixels = { data: new Uint8Array(side * side * 4), width: side, height: side };
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const i = (y * side + x) * 4;
        const marked = x > 8 && x < 40 && y > 8 && y < 40 && ((x >> 2) + (y >> 2)) % 2 === 0;
        src.data[i] = marked ? 0x20 : 0xc0;
        src.data[i + 1] = marked ? 0x30 : 0xc8;
        src.data[i + 2] = marked ? 0x40 : 0xd0;
        src.data[i + 3] = 255;
      }
    }
    const window = salientCrop(src, { width: 16, height: 16 })!;
    expect(window).not.toBeNull();
    expect(window.x + window.width / 2).toBeLessThan(side / 2);
    expect(window.y + window.height / 2).toBeLessThan(side / 2);
  });

  it('declines a picture whose detail is spread evenly, rather than guessing', () => {
    // A checker over the whole subject.
    const side = 96;
    const even: SourcePixels = { data: new Uint8Array(side * side * 4), width: side, height: side };
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const i = (y * side + x) * 4;
        const on = ((x >> 2) + (y >> 2)) % 2 === 0;
        src(even.data, i, on ? 0x20 : 0xc0);
      }
    }
    expect(salientCrop(even, { width: 16, height: 16 })).toBeNull();
  });
});

/** Writes one opaque grey pixel. */
function src(data: Uint8Array | Uint8ClampedArray, at: number, grey: number): void {
  data[at] = grey; data[at + 1] = grey; data[at + 2] = grey; data[at + 3] = 255;
}
