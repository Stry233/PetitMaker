/**
 * A PICTURE BUILT SMALL HAS TO STILL BE THE PICTURE (#28).
 *
 * Two pieces of pastel art pasted into a twenty-cell region came back as a square of one tier with six
 * specks in it, and as the subject's silhouette rendered as one featureless slab. Two faults, both of
 * which this file pins against:
 *
 *  1. A PALETTE THAT CANNOT REACH THE PICTURE. The terrain ramp runs from luma 184 at layer 1 down to
 *     79 at layer 8, and pastel art lives above 200 almost everywhere, so matched raw every cell of it
 *     takes layer 1 and the result is flat by arithmetic. So the picture's own tonal range is fitted
 *     onto the palette's before anything is matched.
 *  2. A BACKDROP TREATED AS PART OF THE PICTURE. A JPEG has no alpha, so a wall of white matches to
 *     the nearest colour and paves the whole region, burying the silhouette that is the only thing a
 *     twenty-cell picture really has. So a flat backdrop is keyed out at source resolution.
 *
 * The KIND of picture matters too: a drawing's colours are already a palette, so a cell takes the
 * colour most of it is rather than the average of what it covers, and its exact edges are not diffused
 * into speckle.
 *
 * Image-backed cases skip when their optional fixtures are absent; synthetic cases run everywhere.
 */
// @ts-ignore node builtins are untyped in this tree (no @types/node)
import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  backgroundMask, buildingCrop, cropPixels, readSourceNature, salientCrop, stencilFromPixels,
  BACKGROUND_MIN_DEPTH, BACKGROUND_MIN_SUBJECT_DEPTH, CROP_MAX_SIDE, TRIM_MIN_GAIN, type SourcePixels,
} from '../../../../tools/generation/stencil/stencil-sample';
import {
  fitTarget, luma, narrowRange, paletteToneRange, sourceToneRange, terrainPalette, toneFit,
} from '../../../../tools/generation/stencil/stencil';
import { SMALL_BOX_OFF } from '../../../../tools/generation/stencil/stencil-small';
import { TerrainType, type StencilWaterRole } from '../../../../core/model/types';
import { FACE, HEART, LETTER, photograph, pixels } from './_stencil-art';
import {
  backdropCells, IMAGE_FIXTURE_FILE, loadImageFixtures, pictureTruth, runImage, scoreImage,
} from './_stencil-image';

const RAMP = terrainPalette(8, false).map((entry) => entry.rgb);
const SIZES = [20, 28, 40];

/** A palette with a real spread of hues, standing in for the item catalogue — which runs from white
 *  to near-black, and is therefore the case where a picture needs no fitting at all. */
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
    // HEART is a shape on transparent ground. Padding it with more transparency must not move the
    // answer at all — an alpha-blind count would drift toward "one colour everywhere".
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
    // LETTER is four colours exactly. Every cell of a majority reading has to be one of them; an
    // area reading over its edges invents shades between them.
    const src = pixels(LETTER, 6);
    const own = new Set(Object.values(LETTER.key));
    const majority = claimed(stencilFromPixels(src, { width: 20, height: 20 }, { background: false })!);
    const area = claimed(stencilFromPixels(src, { width: 20, height: 20 }, { nature: 'photographic', background: false })!);
    const invented = (cells: number[]): number => cells.filter((rgb) => !own.has(rgb)).length;
    expect(invented(majority)).toBe(0);
    expect(invented(area)).toBeGreaterThan(0);
  });

  it('gives one flat colour one entry, whichever kind of picture it is called', () => {
    // A field of one colour no palette entry sits on — a grey, so no green is near it and the error is
    // large. It must come back as ONE entry, or a face drawn in one skin tone arrives dithered.
    //
    // THE LABEL DOES NOT DECIDE IT: a small box asks the question per REGION (`stencil-small.ts:
    // regionFlatness`) — a flat area is told in one entry and a true gradient keeps its own shading — so
    // a flat field is one entry whatever the picture is called, which is the better answer to this
    // picture (per-picture diffusion would come back as a mix of entries here). The
    // majority/area switch itself is pinned by the case above (a majority reading invents no colour the
    // picture does not hold) and by the photograph case below, which fails outright if a gradient is
    // posterised.
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

/** An opaque square of one colour with a second colour wherever `ink` says — the shape of a path
 *  tile, which is a field with a pattern in it and no transparency anywhere. */
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
    // White ring of backdrop, a black outline, white INSIDE it. The inside is the same colour as the
    // backdrop and separated from it only by the outline: keying at cell resolution loses it, since
    // a one-cell outline does not seal.
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
    expect(mask[0]).toBe(1);                                   // the corner is backdrop
    expect(mask[(60 * side) + 60]).toBe(0);                    // the subject's own white core is not
    expect(mask[(60 * side) + 32]).toBe(0);                    // nor is its outline

    // Read WITHOUT the auto-trim, which is a question about fitting rather than about keying: with it
    // the keyed field is dropped from the frame entirely and the corner cell is the ring itself.
    const stencil = stencilFromPixels(src, { width: 24, height: 24 }, { trim: false })!;
    expect(stencil.coverage[0]).toBe(0);
    expect(stencil.coverage[12 * 24 + 12]).toBeGreaterThanOrEqual(128);
  });

  it('leaves a picture with no backdrop alone', () => {
    expect(backgroundMask(photograph(128))).toBeNull();          // no uniform border
    expect(backgroundMask(pixels(HEART, 6))).toBeNull();         // transparent already
  });

  it('does not mistake a drawn RIM for one', () => {
    // FACE is ringed in its own orange. That ring is one colour, touches every edge and is a sixth
    // of the picture; what it is not is deep.
    expect(backgroundMask(pixels(FACE, 6))).toBeNull();
    const built = runImage(pixels(FACE, 6), { side: 24 });
    const rim = built.stencil;
    expect([...rim.coverage].filter((c) => c >= 128).length)
      .toBe([...stencilFromPixels(pixels(FACE, 6), { width: 24, height: 24 }, { background: false })!.coverage]
        .filter((c) => c >= 128).length);
  });

  it('is not a backdrop when it leaves no subject', () => {
    // A FLAT TILE: one colour edge to edge, which is what a path surface is. The border is that
    // colour, the flood reaches every pixel of the picture and it is as deep as anything could ask —
    // so all three gates on the FIELD pass, and the mask keyed the picture out of existence. Six of
    // the dataset's path tiles built nothing at all at every size and material for exactly this.
    expect(backgroundMask(field(128, 0xd9c9a8, () => false))).toBeNull();

    // The same tile with mortar lines in it: the lines are not the field's colour, so they survive
    // the flood as a hairline. A hairline is not a subject either.
    const lines = (x: number, y: number): boolean => x % 16 === 0 || y % 16 === 0;
    expect(backgroundMask(field(128, 0xd9c9a8, lines, 0x6b4a2a))).toBeNull();

    // And both of them build, which is the point of the gate rather than the gate itself.
    for (const tile of [field(128, 0xd9c9a8, () => false), field(128, 0xd9c9a8, lines, 0x6b4a2a)]) {
      const stencil = stencilFromPixels(tile, { width: 24, height: 24 })!;
      expect([...stencil.coverage].filter((c) => c >= 128).length).toBeGreaterThan(500);
    }
  });

  it('still keys a field that has a subject standing in it', () => {
    // The control: the same flat field, with something in the middle thick enough to survive the
    // erosion. The field goes and the subject stays, which is what the pass is for.
    const block = (x: number, y: number): boolean => x >= 44 && x < 84 && y >= 44 && y < 84;
    const mask = backgroundMask(field(128, 0xd9c9a8, block, 0x304050));
    expect(mask).not.toBeNull();
    expect(mask![0]).toBe(1);
    expect(mask![64 * 128 + 64]).toBe(0);
  });

  it('wants depth, and says so in the same units at any resolution', () => {
    // The same drawing at two scales must be judged the same way, which is what a share of the side
    // buys over a count of pixels.
    expect(backgroundMask(pixels(FACE, 3))).toBeNull();
    expect(backgroundMask(pixels(FACE, 12))).toBeNull();
    expect(BACKGROUND_MIN_DEPTH).toBeGreaterThan(0);
    expect(BACKGROUND_MIN_SUBJECT_DEPTH).toBeGreaterThan(0);
  });
});

/**
 * THE REGION IS SPENT ON WHAT THE PICTURE BUILDS.
 *
 * A sticker photographed on a sheet of white is mostly white, and that white is keyed to nothing: the
 * subject took a third of the painted region and the rest of it went on cells that lay nothing at all.
 * So the border rows and columns that build nothing are dropped and what is left is fitted again.
 */
describe('a picture is fitted by what it builds', () => {
  /** A grey square on a transparent field: `inset` pixels of nothing around a subject that is all
   *  ink, which is the shape of the problem with none of a real picture's noise. */
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
    // The subject was a sixth of the region and is now the whole of it.
    expect(claimedCells(stencilFromPixels(src, box, { trim: false })!)).toBeLessThan(80);
    expect(claimedCells(stencilFromPixels(src, box, {})!)).toBe(400);
  });

  it('never reaches into the picture, however little of the middle builds', () => {
    // A thick ring: its inside builds nothing at all, and it is not a border. The crop is the ring's
    // own bounds and the hole is still a hole afterwards.
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
    expect(stencil.coverage[12 * 24 + 12]).toBeLessThan(128);     // the hole survives the trim
    expect(stencil.coverage[0]).toBeGreaterThanOrEqual(128);      // and the ring reaches the frame
  });

  it('leaves a picture that builds nothing exactly as it was', () => {
    // Nothing to fit to. The run lays nothing and says so in its own words, which is the message this
    // must not take away by cropping to an empty rectangle.
    const empty: SourcePixels = { data: new Uint8Array(64 * 64 * 4), width: 64, height: 64 };
    expect(buildingCrop(empty, { width: 20, height: 20 }, {})).toBeNull();
    expect(claimedCells(stencilFromPixels(empty, { width: 20, height: 20 }, {})!)).toBe(0);
  });

  it('trims nothing from a picture that fills its own frame', () => {
    // A photograph has no keyed backdrop and no transparency, so every border cell builds and there
    // is nothing to drop. Cell for cell the same map as before there was a trim at all.
    expect(buildingCrop(photograph(128), { width: 24, height: 24 }, {})).toBeNull();
    const run = runImage(photograph(128), { side: 24 });
    expect(run.trimmed).toBe(0);
    expect(run.built).toEqual(runImage(photograph(128), { side: 24, sample: { trim: false } }).built);
  });

  it('takes a rim only when the subject comes out meaningfully bigger', () => {
    // Two pixels of nothing around a hundred is a fortieth of the picture: re-fitting moves every
    // cell's phase against it and buys a subject nobody can see grow, so the rim is left alone.
    expect(buildingCrop(inField(100, 2), { width: 20, height: 20 }, {})).toBeNull();
    expect(TRIM_MIN_GAIN).toBeGreaterThan(1);
  });

  it('is one answer per picture, box and reading, and asking it twice changes nothing', () => {
    const src = inField(100, 30);
    const box = { width: 20, height: 20 };
    const once = stencilFromPixels(src, box, {})!;
    expect([...once.coverage]).toEqual([...stencilFromPixels(src, box, {})!.coverage]);
    // IDEMPOTENT: the crop is a fixed point after one pass, so a plan cannot drift by being read
    // again — what the preview was fitted to is what the build is fitted to.
    const crop = buildingCrop(src, box, {})!;
    expect(buildingCrop(cropPixels(src, crop), box, {})).toBeNull();
  });

  it('asks the same question in every material, since a covered cell builds in all of them', () => {
    // The palettes a picture can be told in have no entry that lays nothing: a covered cell is a
    // green, the blue, or an item, whichever material was asked for. So one trim serves them all and
    // the material cannot move the frame.
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
    // Pastel art: the whole of it is brighter than the brightest green, which is the flat-result case
    // exactly. It comes down to the top of the ramp and keeps the range it had.
    const ramp = paletteToneRange(RAMP.map((rgb) => ({ rgb })));
    const moved = fitTarget({ lo: 200, hi: 255 }, ramp);
    expect(moved.hi).toBeCloseTo(ramp.hi, 5);
    expect(moved.hi - moved.lo).toBeCloseTo(55, 5);
  });

  it('squeezes one that is wider than the palette, and never magnifies a narrow one', () => {
    const ramp = paletteToneRange(RAMP.map((rgb) => ({ rgb })));
    expect(fitTarget({ lo: 0, hi: 255 }, ramp)).toEqual(ramp);
    // A single colour has no range at all: it lands where its own tone is, not in the middle of a
    // ramp it was never asked about.
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
    expect((red >> 16) & 0xff).toBeGreaterThan((red >> 8) & 0xff);          // still redder than green
    // Pushed to the top of a range, a saturated colour cannot keep its full chroma and no channel
    // may be clipped on its own: what comes back is paler, not a different hue.
    const pale = toneFit({ lo: 0, hi: 255 }, { lo: 250, hi: 250 })(0xd44a5a);
    expect((pale >> 16) & 0xff).toBeGreaterThanOrEqual((pale >> 8) & 0xff);
    expect(luma(pale)).toBeCloseTo(250, 0);
  });

  it('is a no-op, byte for byte, when the palette already covers the picture', () => {
    // NOT MERELY "the same range in, the same range out". Mapping a range onto itself still clamps
    // every cell outside the measured percentiles — 4% of the picture by construction — and rounds
    // each channel through the arithmetic. An outlier has to come back untouched, which is what the
    // colours below are: one far above the range and one far below it.
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

  it('is deterministic, twice over the same picture', () => {
    const src = pixels(FACE, 6);
    expect(runImage(src, { side: 22 }).built).toEqual(runImage(src, { side: 22 }).built);
  });

  it('builds a picture the palette covers exactly as it did before there was a fit', () => {
    // The object catalogue runs from white to near-black, so a picture matched against it is
    // already in reach and the fit must be a NO-OP — not "almost", since the percentile clip would
    // otherwise move the brightest and darkest cells of every picture that round-trips.
    // `fitTones: false` is the un-fitted reading, and the two have to agree cell for cell.
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
 * THE MATERIAL ASKED FOR IS THE MATERIAL BUILT, AND THE REGION AROUND IT IS NOT.
 *
 * Two failures, opposite ends of the same knob. A picture asked for in water came back with next to
 * no water in it: the blue was one entry among eight greens, so only a genuinely blue area ever won
 * it. The answer to that was to give the material the whole painted region — which flooded it, and
 * is the second failure: the picture stands IN terrain and water is what fills its inside, so a cell
 * the picture does not cover stays the ground it was, exactly as under every other material.
 */
describe('the material a picture is asked for is the material it gets', () => {
  const cases = [['heart', HEART], ['face', FACE], ['letter', LETTER]] as const;

  /**
   * What stands on the picture's cells, on its silhouette, and on the region around it, once the run
   * has committed.
   *
   * `outsideBuilt` counts writes to region cells outside the picture's coverage.
   */
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
        // The picture's INSIDE: covered, with every edge neighbour covered too. A cell off the box
        // reads as covered, the way the engine's own silhouette test does.
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

  /**
   * THE WATER IS IN THE PICTURE, AND THE PICTURE IS WHERE THE PICTURE IS.
   *
   * The share is measured over the FIGURE because that is what the material builds; the region is
   * measured for zero, because the flood is the failure this pins. Our own art is a drawing with
   * light areas in it, so every case here has real ponds and a real figure standing around them.
   */
  it('sinks the picture\'s light and leaves the region around it as it was', () => {
    for (const [name, art] of cases) {
      for (const side of SIZES) {
        const b = built(pixels(art, 6), side, 'primary');
        expect(b.violations, `${name}@${side}`).toBe(0);
        expect(b.outsideBuilt, `${name}@${side}`).toBe(0);       // the flood, if it ever returns
        // BOTH materials, on every one of them: the water is the light the ramp cannot say, so a
        // figure has some and is never only that — how much is the picture's own business.
        expect(b.water, `${name}@${side}`).toBeGreaterThan(0);
        expect(b.mountain, `${name}@${side}`).toBeGreaterThan(0);
        expect(b.water + b.mountain, `${name}@${side}`).toBe(b.covered);
      }
    }
    // A photograph too: it has blues of its own, and the material still has to be the material.
    const photo = built(photograph(128), 24, 'primary');
    expect(photo.water).toBeGreaterThan(0);
    expect(photo.outsideBuilt).toBe(0);
  });

  /**
   * AND THE SILHOUETTE IS THE BANK. A pond that reaches the picture's own edge is a hole where the
   * shape should be: what says "this is a figure with water in it" rather than "this is a puddle" is
   * that the outline stands in terrain the whole way round, whatever the tone there.
   */
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

  /**
   * A PICTURE THAT IS ALL EDGE HAS NO INSIDE, so it is built in terrain and nothing is sunk.
   *
   * A comb of one-cell stripes is every cell a silhouette cell. There is nowhere a pond could go that
   * would not be the shape itself, and the honest answer is a figure with no water in it rather than
   * a stripe of blue where the drawing was.
   */
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

  /**
   * THE EDGE STANDS EVEN WHERE IT IS THE BRIGHTEST PART OF THE PICTURE — otherwise the bank could be
   * a consequence of outlines usually being dark, and every other case here would pass unchanged.
   *
   * The subject below is BRIGHTEST at its edge and dark in the middle, so a tone reading alone would
   * sink its border and raise its centre. The border is the shape.
   */
  it('draws the silhouette even where the edge is the brightest part of the picture', () => {
    const px = 32, lo = 8, hi = 24;
    const data = new Uint8Array(px * px * 4);
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const i = y * px + x;
        const inside = x >= lo && x < hi && y >= lo && y < hi;
        // Bright at the rim, dark at the core.
        const toEdge = Math.min(x - lo, hi - 1 - x, y - lo, hi - 1 - y);
        const v = inside ? Math.max(40, 240 - toEdge * 28) : 0;
        data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v;
        data[i * 4 + 3] = inside ? 255 : 0;
      }
    }
    // The FILE'S frame, not the trimmed one: this is about what the composition does with an edge,
    // and a trimmed subject fills the box, where the only edge is the region's own.
    const run = runImage({ data, width: px, height: px }, { side: 24, water: 'primary', sample: { trim: false } });
    const at = (x: number, y: number): number | undefined =>
      run.state.cells[run.origin.y + y]?.[run.origin.x + x]?.terrain?.elevation;
    const isWater = (x: number, y: number): boolean =>
      run.state.cells[run.origin.y + y]?.[run.origin.x + x]?.terrain?.type === TerrainType.Water;
    // Walk the subject's own border row and find its first covered cell; it must be raised, not water.
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

  /**
   * A REGION IS NOT ITS BOUNDING BOX. Every other case here fits a picture to a rectangle, where the
   * two agree and a bug in the scope cannot show; this one paints a diagonal half, which no bounding
   * rectangle can stand in for.
   */
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
    // A subject with no tones has no light to sink and no shade to raise, so a tone reading finds
    // either all of it or none of it. The material it was asked for decides: the inside is the lake
    // and the silhouette is the bank that holds it.
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

// The two attachments from that report. Internal, so absent from the public snapshot.
if (existsSync(IMAGE_FIXTURE_FILE)) {
  describe('the reported pictures, at the sizes they were reported at', () => {
    const fixtures = loadImageFixtures(readFileSync(IMAGE_FIXTURE_FILE, 'utf8'));
    const source = (name: string): SourcePixels => fixtures.find((f) => f.name === name)!;

    /** The plain reading, kept here as the comparison: colour by area, backdrop kept, fitted to the
     *  file's own frame, no tone fit. */
    const BEFORE = {
      sample: { nature: 'photographic' as const, background: false, trim: false }, fitTones: false,
    };

    for (const name of ['girl', 'bunny']) {
      for (const side of SIZES) {
        it(`${name} at ${side} cells reads as itself`, () => {
          const src = source(name);
          // EACH READING IS SCORED AGAINST ITS OWN FRAME. The two fit the picture differently now, so
          // one reference cannot serve both: measuring the file-fitted run against the trimmed
          // picture's cells compares two different pictures rather than two readings of one.
          const now = scoreImage(
            runImage(src, { side }), pictureTruth(src, side), RAMP, backdropCells(src, side),
          );
          const was = scoreImage(
            runImage(src, { side, ...BEFORE }), pictureTruth(src, side, false), RAMP,
            backdropCells(src, side, false),
          );

          expect(now.violations).toBe(0);
          expect(now.spread).toBeGreaterThan(0.4);
          // THE FAILURE THIS TEST WAS WRITTEN FOR, asserted where the comparison is still clean. The
          // plain reading uses almost none of the ramp — that was true at every size, and it is now true
          // only ABOVE the small-box gate, because the small box composes the picture in regions and
          // allocates the ramp across them whether or not the tones were fitted first (`stencil-small.ts`).
          // Below the gate the two readings are both composed, so what separates them there is no longer
          // the fit; the product claim at those sizes is the line above and the fidelity floor below.
          if (side >= SMALL_BOX_OFF) {
            expect(was.spread).toBeLessThan(0.3);
            expect(now.spread).toBeGreaterThan(was.spread * 1.5);
          }
          // A FLOOR OVER A HARDER QUESTION. The trim hands the subject about twice the cells it had,
          // and fidelity is measured over exactly those: the same score now says the picture is
          // carried across twice as much of the region, and the smallest size of the softest picture
          // (bunny at twenty, all pastel and no line) sits at 0.27 where it read 0.34 over half as
          // many cells. What the floor rules out is a result that stopped being the picture.
          expect(now.fidelity).toBeGreaterThan(0.25);
          // Nothing is built on the backdrop, whether the picture declares one with alpha (the
          // sticker) or with a wall of white (the JPEG, whose white would pave the region edge to edge).
          expect(now.spill).toBe(0);
          // AND THE TWO ARE LEVEL ON FIDELITY at the top size, which they always were: given forty cells
          // the plain reading has enough resolution for the subject to show through its own flatness.
          // What it still does there is pave everything around it, which `spill` above is about.
          if (side >= SMALL_BOX_OFF) expect(now.fidelity).toBeGreaterThanOrEqual(was.fidelity * 0.95);
        });
      }
    }

    /**
     * THE WATER MATERIAL'S OWN PICTURE, and the reason it is in the fixtures: a subject whose light
     * is in a few named places — an ear's fluff, the cheeks, a muzzle — inside a dark outline. What
     * a visitor asked for and got is ponds exactly there, in a figure that stands in terrain, on a
     * region that is otherwise the grass it was.
     */
    for (const side of SIZES) {
      it(`the icon at ${side} cells puts its water inside the figure and nowhere else`, () => {
        const src = source('yunguo');
        const run = runImage(src, { side, water: 'primary' });
        const shown = (x: number, y: number): boolean =>
          (run.stencil.coverage[y * side + x] ?? 0) >= 128;
        let covered = 0, water = 0, outsideBuilt = 0;
        for (let y = 0; y < side; y++) {
          for (let x = 0; x < side; x++) {
            const terrain = run.state.cells[run.origin.y + y]?.[run.origin.x + x]?.terrain;
            if (!shown(x, y)) { if (terrain) outsideBuilt++; continue; }
            covered++;
            if (terrain?.type === TerrainType.Water) water++;
          }
        }
        expect(run.violations).toBe(0);
        expect(outsideBuilt, 'the region around the figure is untouched').toBe(0);
        // A quarter or so of the figure, which is what its cream areas come to. The band is wide
        // because the sampling of a small region moves them a little; what it excludes is a figure
        // with no water in it and a figure that is nothing else.
        expect(water / covered).toBeGreaterThan(0.1);
        expect(water / covered).toBeLessThan(0.5);
      });
    }

    /**
     * THE REPORTED PICTURES ARE A SUBJECT ON A SHEET OF WHITE, which is what the auto-trim is for:
     * both are about half backdrop, and fitted by the file that half is region spent on nothing.
     */
    for (const name of ['girl', 'bunny']) {
      it(`${name} fills the region it is given, where its file only filled a third of it`, () => {
        const src = source(name);
        for (const side of SIZES) {
          const now = runImage(src, { side });
          const file = runImage(src, { side, sample: { trim: false } });
          const claimed = (run: typeof now): number =>
            [...run.stencil.coverage].filter((c) => c >= 128).length;
          expect(now.trimmed, `${name}@${side}`).toBeGreaterThan(0.5);
          expect(claimed(now), `${name}@${side}`).toBeGreaterThan(claimed(file) * 1.8);
          expect(now.violations, `${name}@${side}`).toBe(0);
        }
      });
    }

    it('leaves a picture that already fills its own frame where it is', () => {
      // The icon carries barely any margin at the sizes a region gives it, so there is nothing to
      // drop and the map is what it was. At twenty cells its outermost detail falls under the
      // coverage a cell is claimed at, which is a real empty rim and is taken.
      const src = source('yunguo');
      for (const side of [28, 40]) {
        const run = runImage(src, { side });
        expect(run.trimmed, `yunguo@${side}`).toBe(0);
        expect(run.built, `yunguo@${side}`)
          .toEqual(runImage(src, { side, sample: { trim: false } }).built);
      }
      expect(runImage(src, { side: 20 }).trimmed).toBeGreaterThan(0);
    });

    it('reads every one of them as a drawing, the map screenshots included', () => {
      for (const fixture of fixtures) {
        expect(readSourceNature(fixture).nature, fixture.name).toBe('flat');
      }
    });

    it('keys the JPEG\'s white backdrop out and keeps the subject whole', () => {
      const src = source('girl');
      const mask = backgroundMask(src)!;
      expect(mask).not.toBeNull();
      // The subject is what is left, and it is most of the middle of the frame rather than an
      // outline: a leak through the drawn line would take the face with it.
      const middle = (mask[(Math.round(src.height / 2) * src.width) + Math.round(src.width / 2)] ?? 1) === 0;
      expect(middle).toBe(true);
      expect(backgroundMask(source('bunny'))).toBeNull();   // alpha already says it
    });
  });
} else {
  it.skip('internal-repo-only: the reported pictures are not present (public-repo export)', () => {});
}

/**
 * THE SALIENT-CROP EXPERIMENT, and the two things a test can say about it: it is OFF unless asked for,
 * and asked for it takes the part of the subject that carries it.
 *
 * Whether building a PART of a picture is a picture the visitor asked for is a judgement, not a
 * measurement, so nothing here asserts that the crop is better. What it asserts is that the default path
 * cannot reach it and that the choice it makes is the one it claims to make.
 */
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
    const big = { width: CROP_MAX_SIDE + 4, height: CROP_MAX_SIDE + 4 };
    expect([...stencilFromPixels(src, big, { crop: true })!.color])
      .toEqual([...stencilFromPixels(src, big)!.color]);
  });

  it('takes the part of the subject the picture changes fastest over', () => {
    // A field of one colour with a marked patch in one corner: the patch is the only thing in the
    // picture that identifies it, and the window has to land on it.
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
    // A checker over the whole subject: no part of it says more than all of it.
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

/** One pixel written as one grey, alpha opaque — the loops above want it and nothing else does. */
function src(data: Uint8Array | Uint8ClampedArray, at: number, grey: number): void {
  data[at] = grey; data[at + 1] = grey; data[at + 2] = grey; data[at + 3] = 255;
}
