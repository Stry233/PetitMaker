/**
 * A stencilled letter survives being built, read off the committed terrain: one piece of ink per piece
 * of the glyph (a corner touch is two blocks on the map), counters the raster held stay open and none
 * are sealed, no lone bumps or bites, the stroke width the region asked for, and no post-stroke
 * violation. The fixture holds real rasters of the shipped faces; measures are `_stencil-metrics.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildGlyph, components, decodeFixture, holes, maskOf, placementGain, raggedness, rawMask,
  scoreGlyph, skeletonRecall, STENCIL_THRESHOLDS, straightness, strokeWidths,
  type RasterFixture, type RasterFixtureFile,
} from './_stencil-metrics';
import { airCells, COVERAGE_ON, GLYPH_LEGIBLE, glyphLegible, textMinBox, type Stencil } from '../../../../tools/generation/stencil/stencil';
import { finishGlyph } from '../../../../tools/generation/stencil/stencil-stroke';
import { glyphExtent } from '../../../../tools/generation/stencil/stencil-stem';

const file = JSON.parse(readFileSync('src/__tests__/fixtures/stencil/stencil-rasters.json', 'utf8') as string) as RasterFixtureFile;
const FIXTURES = decodeFixture(file);
const name = (f: RasterFixture): string => `${f.text} at ${f.width}x${f.height}`;

/** Sizes below `textMinBox` are built and scored too, but only reported: there the face's own raster
 *  loses strokes nothing downstream can restore. */
const underFloor = (f: RasterFixture): boolean =>
  f.width < textMinBox(f.text).width || f.height < textMinBox(f.text).height;

describe('a letter arrives on the map in one piece', () => {
  for (const fixture of FIXTURES) {
    it(`${name(fixture)}`, () => {
      const built = buildGlyph(fixture);
      const score = scoreGlyph(fixture, built);

      // At any size, even under the floor, the run commits legally and leaves ink.
      expect(score.violations, 'post-stroke violations').toBe(0);
      expect(score.cells, 'ink committed').toBeGreaterThan(0);
      expect(score.underFloor, 'the score agrees with the floor').toBe(underFloor(fixture));

      if (!score.underFloor) {
        expect(score.pieces, 'pieces of ink').toBeLessThanOrEqual(score.piecesWanted);
        // Counted against the raster at this size: a counter with no cell to be in is the region's
        // resolution, not this code's doing.
        expect(score.counters, 'counters').toBe(score.countersHeld);
        expect(score.isolated, 'cells standing alone').toBeLessThanOrEqual(score.isolatedHeld);
        const ragged = (score.nubs + score.notches) / score.cells;
        expect(ragged, 'outline damage per cell of ink').toBeLessThanOrEqual(STENCIL_THRESHOLDS.raggedPerCell);
        // A weight the grid cannot hold fuses strokes while every other measure still passes, since
        // the reference is drawn at the same weight.
        expect(score.separation, 'the drawing\'s own stroke separation')
          .toBeGreaterThanOrEqual(STENCIL_THRESHOLDS.separation);
        if (Math.max(...score.runsWanted) > 1) {
          expect(score.density, 'share of the letter\'s box under ink')
            .toBeLessThanOrEqual(STENCIL_THRESHOLDS.density);
        }
        expect(score.recall, 'the reference glyph\'s own skeleton').toBeGreaterThanOrEqual(STENCIL_THRESHOLDS.recall);
        // Measured over the reference's straight edge runs: stems, bars and 45 degree diagonals alike.
        expect(score.straight.deviation, 'a straight edge, in cells off its line')
          .toBeLessThanOrEqual(STENCIL_THRESHOLDS.straightDeviation);
        expect(score.straight.breaks, 'gaps inside a straight edge').toBe(0);
      }
    });
  }
});

describe('the stroke lands on the width the region asked for', () => {
  for (const fixture of FIXTURES) {
    it(`${name(fixture)}`, () => {
      const built = buildGlyph(fixture);
      const { median } = strokeWidths(built.ink);
      // Compared with the raster's own width rather than the design target: the measure reads a 45
      // degree stroke at twice its thickness, and both pictures share that bias.
      expect(median, 'median stroke width, against the raster\'s own')
        .toBeGreaterThanOrEqual(strokeWidths(rawMask(fixture)).median);
    });
  }

  it('and no letter comes out bolder than a fifth of itself', () => {
    // Strokes past about a fifth of the height eat the ground between them. Only letters with no
    // diagonal, so the width measure reads a stroke rather than a crossing.
    for (const fixture of FIXTURES) {
      if (!['I', 'E', 'L'].includes(fixture.text)) continue;
      const score = scoreGlyph(fixture, buildGlyph(fixture));
      if (score.underFloor) continue;
      const extent = glyphExtent(fixture.text, { width: fixture.width, height: fixture.height });
      // A quarter on small letters, where one cell is already 0.11 of nine and the grid decides; a
      // fifth from twenty cells on.
      const bar = extent >= 19 ? 0.2 : 0.25;
      expect(score.width.median / extent, `${name(fixture)} as a share of its own extent`)
        .toBeLessThanOrEqual(bar);
    }
  });
});

/** Each floor is the size at which the measures above start holding, and they hold there. */
describe('a region at the floor its text asks for carries the letter', () => {
  const at = (text: string, size: number): RasterFixture | undefined =>
    FIXTURES.find((f) => f.text === text && f.height === size);

  it('serves EVERY letter in eight cells, which is what a gate asked before one is typed must do', () => {
    expect(textMinBox('E').height).toBe(8);
    expect(textMinBox('M').height).toBe(8);
    for (const letter of ['I', 'E', 'L', 'N', 'Z', 'X', 'M', 'Q', 'z', 'a']) {
      const fixture = at(letter, 8);
      expect(fixture, `${letter} at the floor is in the matrix`).toBeDefined();
      const score = scoreGlyph(fixture!, buildGlyph(fixture!));
      expect(score.separation, `${letter} at eight keeps its strokes apart`)
        .toBeGreaterThanOrEqual(STENCIL_THRESHOLDS.separation);
      expect(score.recall, `${letter} at eight`).toBeGreaterThanOrEqual(STENCIL_THRESHOLDS.recall);
    }
    // At six an M, z or X fuses into a block; the gate cannot know which letter is coming.
    for (const letter of ['M', 'z', 'X']) {
      const score = scoreGlyph(at(letter, 6)!, buildGlyph(at(letter, 6)!));
      expect(score.underFloor, `${letter} at six is under the floor`).toBe(true);
      expect(score.separation, `${letter} at six has fused`).toBeLessThan(STENCIL_THRESHOLDS.separation);
    }
    expect(holes(maskOf(1, 1, () => false)), 'sanity').toBe(0);
  });

  it('leaves the air out where the region cannot spare it', () => {
    // At the floor the ink fills the region, so the air cell kept at larger sizes is dropped.
    expect(airCells('E', { width: 5, height: 5 }), 'at the floor').toBe(0);
    expect(airCells('E', { width: 6, height: 6 }), 'one cell up').toBe(1);
    expect(airCells('HELLO', { width: 40, height: 8 }), 'a word with room').toBe(1);
    expect(airCells('谷', { width: 13, height: 13 }), 'an ideograph at its own ink floor').toBe(0);
  });

  it('keeps word spacing below the conservative native-outline bound', () => {
    expect(textMinBox('HELLO').height).toBe(10);
    expect(textMinBox('HELLO').width).toBe(50);
    const whole = scoreGlyph(at('HELLO', 10)!, buildGlyph(at('HELLO', 10)!));
    expect(whole.pieces, 'five letters, five pieces').toBe(whole.piecesWanted);
    for (const size of [6, 8]) {
      const fixture = at('HELLO', size)!;
      const built = buildGlyph(fixture);
      const cramped = scoreGlyph(fixture, built);
      expect(cramped.underFloor, `${size} is under the row's floor`).toBe(true);
      expect(components(built.ink, 8)).toBe(components(rawMask(fixture), 8));
    }
  });

  it('preserves separate raster components below the conservative dense-text bound', () => {
    expect(textMinBox('谷地').height).toBe(14);
    expect(textMinBox('A谷').height, 'one dense character makes the whole word dense').toBe(14);
    const whole = scoreGlyph(at('谷地', 14)!, buildGlyph(at('谷地', 14)!));
    expect(whole.pieces).toBe(whole.piecesWanted);
    const fixture = at('谷地', 10)!;
    const built = buildGlyph(fixture);
    const cramped = scoreGlyph(fixture, built);
    expect(cramped.underFloor).toBe(true);
    expect(components(built.ink, 8)).toBe(components(rawMask(fixture), 8));
  });

  it('keeps the letter recognisable at every size at or above its floor', () => {
    for (const fixture of FIXTURES) {
      const score = scoreGlyph(fixture, buildGlyph(fixture));
      if (score.underFloor) continue;
      // The reference has four times the resolution, so a smaller region is coarser by construction;
      // the overlap floor keeps it the letter.
      expect(score.iou, `${name(fixture)} against the reference`).toBeGreaterThanOrEqual(0.5);
      if (fixture.height >= 20) expect(score.iou, `${name(fixture)} in a large region`).toBeGreaterThanOrEqual(0.6);
    }
  });
});

/* The finishing passes, on small hand-drawn shapes. */

function stencilOf(rows: string[]): Stencil {
  const height = rows.length, width = rows[0]!.length;
  const coverage = new Uint8Array(width * height);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { coverage[y * width + x] = ch === '.' ? 0 : 255; }));
  return { width, height, coverage, color: new Uint32Array(width * height) };
}

const maskFor = (s: Stencil): ReturnType<typeof maskOf> =>
  maskOf(s.width, s.height, (i) => s.coverage[i]! >= COVERAGE_ON);

/** The stencil as '#' and '.' rows. */
function draw(s: Stencil): string[] {
  return Array.from({ length: s.height }, (_, y) =>
    Array.from({ length: s.width }, (_, x) => (s.coverage[y * s.width + x]! >= COVERAGE_ON ? '#' : '.')).join(''));
}

describe('nothing in the finishing may take the letter apart', () => {
  it('preserves separate marks across partly covered gaps between thick strokes', () => {
    const s = stencilOf(['..##..', '..##..', '......', '..##..', '..##..']);
    s.coverage[2 * s.width + 2] = s.coverage[2 * s.width + 3] = 90;
    finishGlyph(s);
    expect(components(maskFor(s), 8)).toBe(2);
    expect(draw(s)[2]).toBe('......');
  });

  it('preserves ink components and counters for every binary three-cell neighborhood', () => {
    for (let bits = 0; bits < 512; bits++) {
      const s = stencilOf(Array.from({ length: 5 }, () => '.....'));
      for (let i = 0; i < 9; i++) if (bits & (1 << i)) s.coverage[(1 + Math.floor(i / 3)) * 5 + 1 + i % 3] = 255;
      const before = maskFor(s);
      finishGlyph(s);
      const after = maskFor(s);
      expect(components(after, 8), `ink ${bits}`).toBe(components(before, 8));
      expect(holes(after), `counter ${bits}`).toBe(holes(before));
    }
  });

  it('retains the full area of an enclosed gap while smoothing its outer edge', () => {
    const s = stencilOf(['.#####.', '#######', '##...##', '##...##', '#######', '.#####.']);
    const empty = s.coverage.slice();
    finishGlyph(s);
    for (const y of [2, 3]) for (const x of [2, 3, 4]) {
      expect(empty[y * s.width + x]).toBe(0);
      expect(s.coverage[y * s.width + x]).toBe(0);
    }
  });

  it('joins a thinned diagonal, which touches only at its corners until it is', () => {
    // A one-cell diagonal is whole in a raster but a dotted line of separate blocks on the map.
    const s = stencilOf([
      '#.........',
      '.#........',
      '..#.......',
      '...#......',
      '....#.....',
    ]);
    expect(components(maskFor(s), 8)).toBe(1);
    expect(components(maskFor(s), 4)).toBe(5);
    finishGlyph(s);
    expect(components(maskFor(s), 4)).toBe(1);
  });

  it('leaves a shape that is already joined exactly as it was', () => {
    const rows = ['..###..', '..###..', '..###..'];
    const s = stencilOf(rows);
    finishGlyph(s);
    expect(maskFor(s).on).toEqual(maskFor(stencilOf(rows)).on);
  });

  it('carves a lone bump off a stem but never off a wire', () => {
    const body = stencilOf([
      '.####.',
      '.#####',   // the bump
      '.####.',
      '.####.',
    ]);
    expect(raggedness(maskFor(body)).nubs).toBe(1);
    finishGlyph(body);
    expect(raggedness(maskFor(body)).nubs).toBe(0);

    const wire = stencilOf(['..#...', '..#...', '..#...', '..#...']);
    const before = Uint8Array.from(wire.coverage);
    finishGlyph(wire);
    expect(wire.coverage, 'a one-cell stroke is the drawing, not damage').toEqual(before);
  });

  it('fills a dead-end dent and refuses to seal a character\'s own gap', () => {
    const dent = stencilOf([
      '##.##',
      '#####',
      '#####',
    ]);
    finishGlyph(dent);
    expect(maskFor(dent).on.every((v) => v === 1), 'a dent with nothing behind it fills').toBe(true);

    const counter = stencilOf(['#####', '##.##', '#####']);
    finishGlyph(counter);
    expect(draw(counter)).toEqual(['#####', '##.##', '#####']);

    // A pocket whose only way out is one outline cell: covering it would seal a new counter.
    const neck = stencilOf([
      '#####',
      '#...#',
      '#...#',
      '##.##',
      '.....',
    ]);
    const before = holes(maskFor(neck));
    finishGlyph(neck);
    expect(holes(maskFor(neck)), 'no counter conjured').toBe(before);
    expect(maskFor(neck).on[3 * 5 + 2], 'the neck is left open').toBe(0);
  });

  it('holds a counter open through the whole finishing, at every size a letter is written at', () => {
    // A ring is the shape every pass can ruin by sealing, cutting or closing it.
    for (const n of [7, 9, 13, 21]) {
      const rows: string[] = [];
      for (let y = 0; y < n; y++) {
        let row = '';
        for (let x = 0; x < n; x++) {
          const edge = x < 2 || y < 2 || x >= n - 2 || y >= n - 2;
          row += edge ? '#' : '.';
        }
        rows.push(row);
      }
      const s = stencilOf(rows);
      finishGlyph(s);
      const m = maskFor(s);
      expect(components(m, 4), `ring of ${n}`).toBe(1);
      expect(holes(m), `ring of ${n}`).toBe(1);
    }
  });

  it('leaves a stroke the face drew exactly as it drew it', () => {
    for (const width of [1, 2, 3, 5, 9]) {
      for (const axis of ['down', 'across'] as const) {
        const n = width + 6;
        const rows = axis === 'down'
          ? Array.from({ length: n }, () => '.'.repeat(3) + '#'.repeat(width) + '.'.repeat(n - 3 - width))
          : Array.from({ length: n }, (_, y) => (y >= 3 && y < 3 + width ? '#'.repeat(n) : '.'.repeat(n)));
        const s = stencilOf(rows);
        finishGlyph(s);
        expect(draw(s), `a ${width}-cell bar ${axis}`).toEqual(rows);
      }
    }
  });
});

/**
 * The placement fit puts the glyph where the fewest cells sit near the threshold, a proxy for keeping
 * the drawing. Against the ink the face drew (`placementGain`), it beats centring on average at every
 * size and wins more matrix cells than it loses, but not every one.
 */
describe('putting the glyph where the grid can hold it keeps more of the drawing', () => {
  const gains = FIXTURES.map((f) => ({ f, ...placementGain(f) }));

  it('carries more of the ink on average, at every size in the matrix', () => {
    // The gain is about 0.17 at six cells, tapering to near zero by thirty-two; where the ink fills
    // the region no phase can move and the gain is exactly 0.
    for (const size of [...new Set(FIXTURES.map((f) => f.height))]) {
      const at = gains.filter((g) => g.f.height === size);
      const mean = (pick: (g: typeof at[number]) => number): number =>
        at.reduce((total, g) => total + pick(g), 0) / at.length;
      expect(mean((g) => g.fitted), `${size} cells`).toBeGreaterThanOrEqual(mean((g) => g.centred));
    }
  });

  it('wins far more cells of the matrix than it loses', () => {
    const better = gains.filter((g) => g.fitted > g.centred + 1e-9).length;
    const worse = gains.filter((g) => g.fitted < g.centred - 1e-9).length;
    expect(better).toBeGreaterThan(worse * 1.5);
  });

  it('is the difference between a letter and a smear at the small end', () => {
    // Centred, a six-cell E or L puts its bars between rows and keeps about a fifth of its ink;
    // fitted, both keep over nine tenths.
    for (const text of ['E', 'L']) {
      const g = gains.find((x) => x.f.text === text && x.f.height === 6)!;
      expect(g.fitted, `${text} at six, fitted`).toBeGreaterThan(0.85);
      expect(g.centred, `${text} at six, centred`).toBeLessThan(0.35);
    }
  });
});

describe('what was drawn straight is built straight', () => {
  /** Measures the built shape against the ideal rows as reference. */
  const holdsItsLine = (rows: string[], built: Stencil): void => {
    const ideal = maskFor(stencilOf(rows));
    const got = maskFor(built);
    const { runs, deviation, breaks } = straightness(got, ideal);
    expect(runs, 'the ideal offers a straight edge to judge').toBeGreaterThan(0);
    expect(deviation, 'cells off the line').toBe(0);
    expect(breaks, 'gaps along the line').toBe(0);
    expect(components(got, 4), 'one piece on a grid of whole blocks').toBe(1);
  };

  it('a plain line stays a line', () => {
    for (const rows of [
      ['..#...', '..#...', '..#...', '..#...', '..#...', '..#...'],
      ['......', '######', '......'],
      ['..##..', '..##..', '..##..', '..##..', '..##..'],
    ]) {
      const s = stencilOf(rows);
      finishGlyph(s);
      holdsItsLine(rows, s);
    }
  });

  it('a clean diagonal stays clean, and joins on ONE side the whole way down', () => {
    // Every corner touch must be joined, and on one side for the whole run, or the staircase wobbles.
    const rows = [
      '#.......',
      '.#......',
      '..#.....',
      '...#....',
      '....#...',
      '.....#..',
      '......#.',
      '.......#',
    ];
    const s = stencilOf(rows);
    finishGlyph(s);
    const got = maskFor(s);
    expect(components(got, 4), 'one piece').toBe(1);
    const built = draw(s);
    const sides = built.map((row, y) => (row[y + 1] === '#' ? 'right' : row[y - 1] === '#' ? 'left' : 'none'));
    const joined = sides.filter((v) => v !== 'none');
    expect(joined.length, 'every step joined').toBe(rows.length - 1);
    expect(new Set(joined).size, 'all on one side').toBe(1);
    expect(straightness(got, maskFor(stencilOf(rows))).deviation, 'the staircase keeps its slope').toBe(0);
  });

  it('a diagonal drawn the other way is the mirror of it', () => {
    const rows = [
      '.......#',
      '......#.',
      '.....#..',
      '....#...',
      '...#....',
      '..#.....',
      '.#......',
      '#.......',
    ];
    const s = stencilOf(rows);
    finishGlyph(s);
    expect(components(maskFor(s), 4)).toBe(1);
    expect(straightness(maskFor(s), maskFor(stencilOf(rows))).deviation).toBe(0);
  });
});

/** The shelf's card rule (`glyphLegible`), fed the numbers real rasters of fourteen texts at ten sizes
 *  come out with. */
describe('a card is offered by what its own letter can do', () => {
  const verdict = (text: string, size: number): { ok: boolean; separation: number; density: number; pieces: number } => {
    const fixture = FIXTURES.find((f) => f.text === text && f.height === size)!;
    const score = scoreGlyph(fixture, buildGlyph(fixture));
    // `piecesWanted` is the drawing's own count at the reference's 4x resolution.
    return {
      separation: score.separation, density: score.density, pieces: score.pieces,
      ok: glyphLegible({
        separation: score.separation, density: score.density,
        pieces: score.pieces, wholePieces: score.piecesWanted,
        multiStroke: Math.max(...score.runsWanted) > 1,
      }),
    };
  };

  it('offers the letters a small region CAN carry, and refuses the ones it cannot', () => {
    // At five cells an E is three bars and two gaps; an M is two stems and a V and fuses into a block.
    for (const letter of ['E', 'I', 'L']) {
      expect(verdict(letter, 5).ok, `${letter} at five is offered`).toBe(true);
    }
    for (const letter of ['M', 'X', 'a']) {
      expect(verdict(letter, 5).ok, `${letter} at five is refused`).toBe(false);
    }
  });

  it('checks separate letters independently of aggregate stroke separation', () => {
    const separate = verdict('HELLO', 6), merged = verdict('HELLO', 8);
    expect(separate.pieces).toBe(5);
    expect(separate.ok).toBe(true);
    expect(merged.separation).toBeGreaterThan(GLYPH_LEGIBLE.separation);
    expect(merged.pieces).toBeLessThan(5);
    expect(merged.ok).toBe(false);
    expect(verdict('HELLO', 10).ok, 'and offered where its letters stand apart').toBe(true);
  });

  it('offers every letter once the region reaches the blanket floor', () => {
    for (const letter of ['I', 'E', 'L', 'N', 'Z', 'X', 'M', 'Q', 'z', 'a']) {
      expect(verdict(letter, 8).ok, `${letter} at eight`).toBe(true);
    }
  });

  it('reads the same two bars the matrix is judged by', () => {
    expect(GLYPH_LEGIBLE.separation).toBe(STENCIL_THRESHOLDS.separation);
    expect(GLYPH_LEGIBLE.density).toBe(STENCIL_THRESHOLDS.density);
  });
});

describe('the built letter is what the raster said, only quantised', () => {
  it('keeps the reference glyph in view: every fixture recognisable as itself', () => {
    const scores = FIXTURES.map((f) => scoreGlyph(f, buildGlyph(f)));
    const judged = scores.filter((s) => !s.underFloor);
    const legible = judged.filter((s) => s.recall >= STENCIL_THRESHOLDS.recall);
    expect(legible.length, 'matrix cells whose structure survived').toBe(judged.length);
    expect(judged.length, 'and most of the matrix is judged').toBeGreaterThan(scores.length / 2);
  });

  it('reads the raster the harness stored, not one it re-derived', () => {
    // Regenerated against other fonts, every number above would measure a different letter.
    expect(file.font).toContain('PW Rounded Sans');
    expect(file.font).toContain('Alibaba PuHuiTi 3');
    expect(FIXTURES.length).toBeGreaterThan(20);
    for (const f of FIXTURES) {
      expect(f.coverage.length, name(f)).toBe(f.width * f.height);
      expect(f.quad.length, name(f)).toBe(f.width * f.height * 4);
      expect(skeletonRecall(rawMask(f), rawMask(f))).toBe(1);
    }
  });
});
