/**
 * THE LEGIBILITY READING, on grids whose answers are known by construction.
 *
 * `_stencil-image.ts`'s tonal measures answer "did the reduction keep the picture's light and dark".
 * These four answer "can the picture still be READ", which is the question a small box raises,
 * and each is monotone with one named failure: the backdrop eating the subject, coherent areas
 * arriving as fragments, water arriving as specks, and two hues arriving as one colour.
 *
 * Every case here is a hand-built stencil and a hand-built result, so a number is checked against
 * arithmetic rather than against a picture. What these numbers do on REAL pictures is the evaluation
 * harness's business, not a test's.
 */
import { describe, it, expect } from 'vitest';
import type { Stencil } from '../../../../core/model/types';
import {
  GROUND, HUE_CHROMA_MIN, HUE_FAR, HUE_LUMA_NEAR, REGION_MIN, WATER,
  sameLabelRegions, scoreLegibility,
} from './_stencil-image';

/** A stencil of one row per string, `.` uncovered and any other character a colour from `ink`. */
function stencilOf(rows: readonly string[], ink: Record<string, number>): Stencil {
  const height = rows.length, width = rows[0]!.length;
  const coverage = new Uint8Array(width * height);
  const color = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y]![x]!;
      if (ch === '.') continue;
      coverage[y * width + x] = 255;
      color[y * width + x] = ink[ch]!;
    }
  }
  return { width, height, coverage, color, quad: new Uint8Array(width * height * 4), nature: 'flat' };
}

/** The map, as one colour per cell in the same layout. */
function builtOf(rows: readonly string[], ink: Record<string, number>): number[] {
  const out: number[] = [];
  for (const row of rows) for (const ch of row) out.push(ink[ch] ?? GROUND);
  return out;
}

const TIER_A = 0x93c956, TIER_B = 0x298c19;

describe('the cells that share a label, as regions', () => {
  it('walks 4-connected and does not join across a diagonal', () => {
    const grid = ['aa..', 'aa..', '..aa', '..aa'];
    const regions = sameLabelRegions(4, 4, (i) => (grid[(i / 4) | 0]![i % 4] === 'a' ? 1 : null));
    expect(regions.map((r) => r.length).sort()).toEqual([4, 4]);
  });

  it('splits one shape by its label and skips what is not in play', () => {
    const grid = ['aabb', 'aabb'];
    const regions = sameLabelRegions(4, 2, (i) => {
      const ch = grid[(i / 4) | 0]![i % 4]!;
      return ch === 'a' ? 1 : ch === 'b' ? 2 : null;
    });
    expect(regions.map((r) => r.length)).toEqual([4, 4]);
  });

  it('does not wrap a row into the next one', () => {
    // 'a' at the end of row 0 and at the start of row 1 are not neighbours, whatever the flat index
    // arithmetic says.
    const regions = sameLabelRegions(3, 2, (i) => ([0, 0, 1, 1, 0, 0][i] === 1 ? 1 : null));
    expect(regions.map((r) => r.length)).toEqual([1, 1]);
  });
});

describe('presence: the share of the picture that arrived at all', () => {
  const ink = { s: 0x808080 };

  it('counts the ink built on, over the ink the picture has', () => {
    const truth = stencilOf(['ssss', 'ssss'], ink);
    const built = builtOf(['mm..', '..mm'], { m: TIER_A });
    const score = scoreLegibility(built, truth, truth);
    expect(score.footprintCells).toBe(8);
    expect(score.presence).toBeCloseTo(0.5, 5);
  });

  it('is 0 when the run built nothing on the picture, and says how much ink there was', () => {
    const truth = stencilOf(['ssss', 'ssss'], ink);
    const score = scoreLegibility(builtOf(['....', '....'], {}), truth, truth);
    expect(score.presence).toBe(0);
    expect(score.footprintCells).toBe(8);
  });

  it('is taken over the FOOTPRINT, so a subject keyed out of the reading still reads 0', () => {
    // The failure this measure exists for: the backdrop pass took the whole picture, so the SUBJECT
    // reading is empty and every measure taken over it is vacuous — while the picture's own ink is
    // still there, unbuilt. `bare` reads 0 (nothing missing) on the same case.
    const footprint = stencilOf(['ssss', 'ssss'], ink);
    const nothing = stencilOf(['....', '....'], ink);
    const score = scoreLegibility(builtOf(['....', '....'], {}), nothing, footprint);
    expect(score.presence).toBe(0);
    expect(score.footprintCells).toBe(8);
  });

  it('reports 0 cells rather than a share when the picture has no ink', () => {
    const empty = stencilOf(['..', '..'], ink);
    const score = scoreLegibility(builtOf(['..', '..'], {}), empty, empty);
    expect(score.footprintCells).toBe(0);
    expect(score.presence).toBe(0);
  });
});

describe('region survival: the source\'s areas arriving as areas', () => {
  const ink = { a: 0x203040, b: 0xe0d0c0 };

  it('is 1 when each area comes back as one coherent area', () => {
    const truth = stencilOf(['aaabbb', 'aaabbb', 'aaabbb'], ink);
    const built = builtOf(['xxxyyy', 'xxxyyy', 'xxxyyy'], { x: TIER_A, y: TIER_B });
    const score = scoreLegibility(built, truth, truth);
    expect(score.sourceRegions).toBe(2);
    expect(score.regionSurvival).toBeCloseTo(1, 5);
  });

  it('falls when an area arrives as fragments rather than as an area', () => {
    // The right AVERAGE tier over the left area and the right count of each, laid as a checkerboard:
    // every tonal measure is content and the area is gone.
    const truth = stencilOf(['aaabbb', 'aaabbb', 'aaabbb'], ink);
    const built = builtOf(['xyxyyy', 'yxyyyy', 'xyxyyy'], { x: TIER_A, y: TIER_B });
    const score = scoreLegibility(built, truth, truth);
    expect(score.regionSurvival).toBeLessThan(0.6);
  });

  it('is area-weighted, so half the picture surviving reads about a half', () => {
    const truth = stencilOf(['aaabbb', 'aaabbb', 'aaabbb'], ink);
    const built = builtOf(['xxxyzy', 'xxxzyz', 'xxxyzy'], { x: TIER_A, y: TIER_B, z: WATER });
    const score = scoreLegibility(built, truth, truth);
    expect(score.regionSurvival).toBeCloseTo(0.5, 2);
  });

  it('ignores source areas below the size an area means anything at', () => {
    const truth = stencilOf(['ab', 'aa'], ink);       // 'b' is one cell
    const score = scoreLegibility(builtOf(['xx', 'xx'], { x: TIER_A }), truth, truth);
    expect(score.sourceRegions).toBe(1);
    expect(REGION_MIN).toBeGreaterThan(1);
  });

  it('counts the result\'s own coherent areas beside the source\'s', () => {
    const truth = stencilOf(['aaaaaa', 'aaaaaa'], ink);
    const built = builtOf(['xxxyyy', 'xxxyyy'], { x: TIER_A, y: TIER_B });
    const score = scoreLegibility(built, truth, truth);
    expect(score.sourceRegions).toBe(1);
    expect(score.resultRegions).toBe(2);
  });
});

describe('water cohesion: bodies rather than specks', () => {
  const ink = { s: 0x808080 };
  const truth = stencilOf(['sssss', 'sssss', 'sssss'], ink);

  it('is the share of the water that sits in a body', () => {
    // Three cells in one body, two specks apart from it and from each other.
    const built = builtOf(['ww.w.', 'w....', '...w.'], { w: WATER });
    const score = scoreLegibility(built, truth, truth);
    expect(score.waterCells).toBe(5);
    expect(score.waterCohesion).toBeCloseTo(0.6, 5);
  });

  it('is 1 for a pond and 0 for the same amount of water scattered', () => {
    expect(scoreLegibility(builtOf(['ww...', 'ww...', '.....'], { w: WATER }), truth, truth).waterCohesion).toBe(1);
    expect(scoreLegibility(builtOf(['w.w.w', '.....', 'w.w.w'], { w: WATER }), truth, truth).waterCohesion).toBe(0);
  });

  it('reports no water rather than a fragmentation of none', () => {
    const score = scoreLegibility(builtOf(['xxxxx', 'xxxxx', 'xxxxx'], { x: TIER_A }), truth, truth);
    expect(score.waterCells).toBe(0);
    expect(score.waterCohesion).toBe(1);
  });
});

describe('hue separability: two colours arriving as two', () => {
  // Equally light, far apart in hue, both properly coloured: exactly the pair the green ramp cannot
  // tell apart, and the pair a viewer reads the picture by.
  const RED = 0xd23c3c, BLUE = 0x3c5cd2;
  const ink = { r: RED, b: BLUE };
  const truth = stencilOf(['rrrbbb', 'rrrbbb'], ink);

  it('sees the pair the source offers', () => {
    expect(scoreLegibility(builtOf(['xxxyyy', 'xxxyyy'], { x: TIER_A, y: TIER_B }), truth, truth).huePairs).toBe(1);
  });

  it('is 1 when the two areas land on different colours and 0 when they merge', () => {
    expect(scoreLegibility(builtOf(['xxxyyy', 'xxxyyy'], { x: TIER_A, y: TIER_B }), truth, truth).hueSeparability).toBe(1);
    expect(scoreLegibility(builtOf(['xxxxxx', 'xxxxxx'], { x: TIER_A }), truth, truth).hueSeparability).toBe(0);
  });

  it('offers no pair for a subject drawn in one hue, and says so', () => {
    const plain = stencilOf(['rrrrrr', 'rrrrrr'], ink);
    const score = scoreLegibility(builtOf(['xxxyyy', 'xxxyyy'], { x: TIER_A, y: TIER_B }), plain, plain);
    expect(score.huePairs).toBe(0);
    expect(score.hueSeparability).toBe(1);
  });

  it('offers no pair for two GREYS, which the eye does not tell apart by hue either', () => {
    const greys = stencilOf(['gggkkk', 'gggkkk'], { g: 0x909090, k: 0x8a8a8a });
    const score = scoreLegibility(builtOf(['xxxxxx', 'xxxxxx'], { x: TIER_A }), greys, greys);
    expect(score.huePairs).toBe(0);
    expect(HUE_CHROMA_MIN).toBeGreaterThan(0);
  });

  it('offers no pair when the two differ in LIGHTNESS, which the ramp can say', () => {
    // A dark red and a light blue are separable by tone alone, so the ramp is not being asked to
    // carry hue and this measure has nothing to report.
    const toned = stencilOf(['rrrbbb', 'rrrbbb'], { r: 0x3c1010, b: 0xa8c0ff });
    const score = scoreLegibility(builtOf(['xxxxxx', 'xxxxxx'], { x: TIER_A }), toned, toned);
    expect(score.huePairs).toBe(0);
    expect(HUE_LUMA_NEAR).toBeGreaterThan(0);
    expect(HUE_FAR).toBeGreaterThan(0);
  });
});
