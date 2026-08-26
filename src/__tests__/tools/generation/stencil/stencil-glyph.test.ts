/**
 * A STENCILLED LETTER HAS TO SURVIVE BEING BUILT, and the two ways it did not are what this holds.
 *
 * Reported from the shipped build: small text arrived with its strokes broken, large text with a
 * chewed outline. Both were engine defects rather than font ones, and both are invisible in a cell
 * count — a broken letter has the same ink as a whole one, and a gnawed edge has the same shape to
 * within a cell. So the invariants are TOPOLOGICAL and they are read off the terrain the run actually
 * commits, not off the raster it started from:
 *
 *  - the ink is one piece per piece of the glyph, counted the way the MAP counts (a corner touch is
 *    two blocks with ground between them, whatever a raster dump looks like);
 *  - a counter the face's raster held is still open, and no new one has been sealed;
 *  - the outline carries no lone bumps or bites, the shapes the corner trim turns into decorated lumps;
 *  - the stroke lands on the width the region asked for rather than a cell under it;
 *  - and the run commits, with no post-stroke violation.
 *
 * NO BROWSER. The fixture is real font rasters, drawn once through the shipped faces by the project's
 * own evaluation harness and committed; everything downstream of the canvas — the glyph finishing, the
 * stencil plan, the generator's corner trims — runs here over those bytes. The measures are the
 * harness's own (`_stencil-metrics.ts`), so a threshold here and a column in its log cannot mean two
 * different things.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import {
  buildGlyph, components, decodeFixture, holes, maskOf, placementGain, raggedness, rawMask,
  scoreGlyph, skeletonRecall, STENCIL_THRESHOLDS, straightness, strokeWidths,
  type RasterFixture, type RasterFixtureFile,
} from './_stencil-metrics';
import { airCells, COVERAGE_ON, GLYPH_LEGIBLE, glyphLegible, sealsGround, smoothShape, textMinBox, textMinSide, type Stencil } from '../../../../tools/generation/stencil/stencil';
import { bridgeDiagonals, finishGlyph, glyphExtent, smoothOutline } from '../../../../tools/generation/stencil/stencil-stroke';

const file = JSON.parse(readFileSync('src/__tests__/fixtures/stencil-rasters.json', 'utf8') as string) as RasterFixtureFile;
const FIXTURES = decodeFixture(file);
const name = (f: RasterFixture): string => `${f.text} at ${f.width}x${f.height}`;

/**
 * THE MATRIX GOES UNDER THE FLOOR ON PURPOSE. A floor is only worth anything if what lies beneath it
 * was measured too, so the sizes below what a text asks for (`stencil.ts:textMinBox`) are built and
 * scored like everything else and then reported rather than judged: at ten cells an ideograph has
 * strokes the face's own raster could not hold, and nothing downstream can put them back.
 */
const underFloor = (f: RasterFixture): boolean =>
  f.width < textMinBox(f.text).width || f.height < textMinBox(f.text).height;

describe('a letter arrives on the map in one piece', () => {
  for (const fixture of FIXTURES) {
    it(`${name(fixture)}`, () => {
      const built = buildGlyph(fixture);
      const score = scoreGlyph(fixture, built);

      // WHATEVER THE SIZE, a run commits and leaves something standing: under the floor the letter is
      // whatever the region can hold, but it is never nothing and never illegal.
      expect(score.violations, 'post-stroke violations').toBe(0);
      expect(score.cells, 'ink committed').toBeGreaterThan(0);
      expect(score.underFloor, 'the score agrees with the floor').toBe(underFloor(fixture));

      if (!score.underFloor) {
        expect(score.pieces, 'pieces of ink').toBeLessThanOrEqual(score.piecesWanted);
        // Against what the face DREW at this size, not against the letter's true count: a counter with
        // no cell to be in is the region's resolution, while a counter the raster held and the
        // processing closed is this code's doing.
        expect(score.counters, 'counters').toBe(score.countersHeld);
        expect(score.isolated, 'cells standing alone').toBeLessThanOrEqual(score.isolatedHeld);
        const ragged = (score.nubs + score.notches) / score.cells;
        expect(ragged, 'outline damage per cell of ink').toBeLessThanOrEqual(STENCIL_THRESHOLDS.raggedPerCell);
        // THE LETTER'S GAPS ARE THE LETTER. A weight the grid cannot hold fuses two strokes into one
        // and every other measure here still passes, since the reference is drawn at the same weight.
        expect(score.separation, 'the drawing\'s own stroke separation')
          .toBeGreaterThanOrEqual(STENCIL_THRESHOLDS.separation);
        if (Math.max(...score.runsWanted) > 1) {
          expect(score.density, 'share of the letter\'s box under ink')
            .toBeLessThanOrEqual(STENCIL_THRESHOLDS.density);
        }
        expect(score.recall, 'the reference glyph\'s own skeleton').toBeGreaterThanOrEqual(STENCIL_THRESHOLDS.recall);
        // A STRAIGHT PART OF THE DRAWING COMES OUT STRAIGHT. Measured over the runs the reference's
        // own edge holds to one direction, which covers a stem, a bar and a 45 degree diagonal alike.
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
      // NEVER NARROWER THAN THE FACE DREW IT, which is the promise now that nothing reshapes a stroke:
      // every pass left in the finishing only ever ADDS a cell, to join a diagonal or to take a bite
      // out of an outline. Measured against the raster's own width rather than against the design
      // target because the measure — the shorter of the row run and the column run through a cell —
      // reads a 45 degree stroke at twice its thickness, and the two pictures share that bias.
      expect(median, 'median stroke width, against the raster\'s own')
        .toBeGreaterThanOrEqual(strokeWidths(rawMask(fixture)).median);
    });
  }

  it('and no letter comes out bolder than a fifth of itself', () => {
    // THE READING A VISITOR MADE: "the stroke is too bold, the path is not clear". A stencilled letter
    // whose strokes pass about a fifth of its own height has eaten the ground between them, and the
    // face's BOLD instance did exactly that at every size — measured on letters with no diagonal, so
    // the width measure is reading a stroke rather than a 45 degree crossing.
    for (const fixture of FIXTURES) {
      if (!['I', 'E', 'L'].includes(fixture.text)) continue;
      const score = scoreGlyph(fixture, buildGlyph(fixture));
      if (score.underFloor) continue;
      const extent = glyphExtent(fixture.text, { width: fixture.width, height: fixture.height });
      // A QUARTER at the small end, where one whole cell of a nine-cell letter is already 0.11 and the
      // next cell up is 0.22: the grid, not the weight, decides there. A fifth from twenty cells on,
      // where the weight is the only thing that can make a stroke heavier.
      const bar = extent >= 19 ? 0.2 : 0.25;
      expect(score.width.median / extent, `${name(fixture)} as a share of its own extent`)
        .toBeLessThanOrEqual(bar);
    }
  });
});

/**
 * WHAT THE FLOORS BUY, which is the other half of declaring one. Each is the size at which the
 * measures above start holding, and the evidence is that they hold AT it: below, the letter is
 * whatever the region can hold and the matrix says so.
 */
describe('a region at the floor its text asks for carries the letter', () => {
  const at = (text: string, size: number): RasterFixture | undefined =>
    FIXTURES.find((f) => f.text === text && f.height === size);

  it('serves EVERY letter in eight cells, which is what a gate asked before one is typed must do', () => {
    expect(textMinSide('E')).toBe(8);
    expect(textMinSide('M')).toBe(8);
    for (const letter of ['I', 'E', 'L', 'N', 'Z', 'X', 'M', 'Q', 'z', 'a']) {
      const fixture = at(letter, 8);
      expect(fixture, `${letter} at the floor is in the matrix`).toBeDefined();
      const score = scoreGlyph(fixture!, buildGlyph(fixture!));
      expect(score.separation, `${letter} at eight keeps its strokes apart`)
        .toBeGreaterThanOrEqual(STENCIL_THRESHOLDS.separation);
      expect(score.recall, `${letter} at eight`).toBeGreaterThanOrEqual(STENCIL_THRESHOLDS.recall);
    }
    // AND CANNOT AT SIX, which is the reason for the floor rather than an assertion about it: an E is
    // three bars and two gaps and would serve at five, but an M is two stems and a V in the same
    // square and fuses into a block. The gate cannot know which letter is coming.
    for (const letter of ['M', 'z', 'X']) {
      const score = scoreGlyph(at(letter, 6)!, buildGlyph(at(letter, 6)!));
      expect(score.underFloor, `${letter} at six is under the floor`).toBe(true);
      expect(score.separation, `${letter} at six has fused`).toBeLessThan(STENCIL_THRESHOLDS.separation);
    }
    expect(holes(maskOf(1, 1, () => false)), 'sanity').toBe(0);
  });

  it('leaves the air out where the region cannot spare it', () => {
    // The floor IS the ink, so nothing is left over for the cell of air the fit keeps at every larger
    // size: a five-cell region less its air would leave four rows for a letter that needs five.
    expect(airCells('E', { width: 5, height: 5 }), 'at the floor').toBe(0);
    expect(airCells('E', { width: 6, height: 6 }), 'one cell up').toBe(1);
    expect(airCells('HELLO', { width: 40, height: 8 }), 'a word with room').toBe(1);
    expect(airCells('谷', { width: 13, height: 13 }), 'an ideograph at its own ink floor').toBe(0);
  });

  it('asks a row of letters for ten each, since the gaps between them round away first', () => {
    expect(textMinSide('HELLO')).toBe(10);
    expect(textMinBox('HELLO').width).toBe(50);
    const whole = scoreGlyph(at('HELLO', 10)!, buildGlyph(at('HELLO', 10)!));
    expect(whole.pieces, 'five letters, five pieces').toBe(whole.piecesWanted);
    // The side bearings go before the strokes do: at eight the letters are drawn well enough and two
    // of them touch anyway, which is why the row's floor is above a single letter's.
    for (const size of [6, 8]) {
      const cramped = scoreGlyph(at('HELLO', size)!, buildGlyph(at('HELLO', size)!));
      expect(cramped.underFloor, `${size} is under the row's floor`).toBe(true);
      expect(cramped.pieces, `at ${size} they touch`).toBeLessThan(cramped.piecesWanted);
    }
  });

  it('asks an ideograph for fourteen, where a letter asks for six', () => {
    expect(textMinSide('谷地')).toBe(14);
    expect(textMinSide('A谷'), 'one dense character makes the whole word dense').toBe(14);
    const whole = scoreGlyph(at('谷地', 14)!, buildGlyph(at('谷地', 14)!));
    expect(whole.pieces).toBe(whole.piecesWanted);
    const cramped = scoreGlyph(at('谷地', 10)!, buildGlyph(at('谷地', 10)!));
    expect(cramped.underFloor).toBe(true);
    expect(cramped.pieces, 'at ten the strokes merge').toBeLessThan(cramped.piecesWanted);
  });

  it('keeps the letter recognisable at every size at or above its floor', () => {
    for (const fixture of FIXTURES) {
      const score = scoreGlyph(fixture, buildGlyph(fixture));
      if (score.underFloor) continue;
      // The reference is the same letter at the same weight with four times the resolution, so a
      // smaller region is a coarser picture by construction. What must not happen is the picture
      // ceasing to be the letter, which is what a floor under the overlap says.
      expect(score.iou, `${name(fixture)} against the reference`).toBeGreaterThanOrEqual(0.5);
      if (fixture.height >= 20) expect(score.iou, `${name(fixture)} in a large region`).toBeGreaterThanOrEqual(0.6);
    }
  });
});

/* ── the passes, on shapes small enough to reason about ────────────────────────────────────── */

function stencilOf(rows: string[]): Stencil {
  const height = rows.length, width = rows[0]!.length;
  const coverage = new Uint8Array(width * height);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { coverage[y * width + x] = ch === '.' ? 0 : 255; }));
  return { width, height, coverage, color: new Uint32Array(width * height) };
}

const maskFor = (s: Stencil): ReturnType<typeof maskOf> =>
  maskOf(s.width, s.height, (i) => s.coverage[i]! >= COVERAGE_ON);

/** The stencil back as the rows it was written from, for comparing a shape with what it started as. */
function draw(s: Stencil): string[] {
  return Array.from({ length: s.height }, (_, y) =>
    Array.from({ length: s.width }, (_, x) => (s.coverage[y * s.width + x]! >= COVERAGE_ON ? '#' : '.')).join(''));
}

describe('nothing in the finishing may take the letter apart', () => {
  it('joins a thinned diagonal, which touches only at its corners until it is', () => {
    // What a stroke at a shallow angle comes out as once it is one cell wide: whole in a raster dump,
    // and a dotted line of separate blocks on a map.
    const s = stencilOf([
      '#.........',
      '.#........',
      '..#.......',
      '...#......',
      '....#.....',
    ]);
    expect(components(maskFor(s), 8)).toBe(1);
    expect(components(maskFor(s), 4)).toBe(5);
    bridgeDiagonals(s, Uint8Array.from(s.coverage));
    expect(components(maskFor(s), 4)).toBe(1);
  });

  it('leaves a shape that is already joined exactly as it was', () => {
    const rows = ['..###..', '..###..', '..###..'];
    const s = stencilOf(rows);
    expect(bridgeDiagonals(s, Uint8Array.from(s.coverage))).toBe(0);
    expect(maskFor(s).on).toEqual(maskFor(stencilOf(rows)).on);
  });

  it('carves a lone bump off a stem but never off a wire', () => {
    const body = stencilOf([
      '.####.',
      '.#####',   // the one cell too far
      '.####.',
      '.####.',
    ]);
    expect(raggedness(maskFor(body)).nubs).toBe(1);
    smoothOutline(body);
    expect(raggedness(maskFor(body)).nubs).toBe(0);

    const wire = stencilOf(['..#...', '..#...', '..#...', '..#...']);
    const before = Uint8Array.from(wire.coverage);
    smoothOutline(wire);
    expect(wire.coverage, 'a one-cell stroke is the drawing, not damage').toEqual(before);
  });

  it('fills a dead-end dent and refuses to seal a character\'s own gap', () => {
    const dent = stencilOf([
      '#####',
      '##.##',   // three ink sides, and the way out is the way in
      '#####',
    ]);
    smoothOutline(dent);
    expect(maskFor(dent).on.every((v) => v === 1), 'a dent with nothing behind it fills').toBe(true);

    // A pocket whose only way out is one cell of the outline: covering that cell shuts it in, which
    // on an ideograph is a stroke gap turning into a filled-in blob.
    const neck = stencilOf([
      '#####',
      '#...#',
      '#...#',
      '##.##',
      '.....',
    ]);
    expect(sealsGround(neck, 2, 3), 'the guard names the neck').toBe(true);
    const before = holes(maskFor(neck));
    smoothShape(neck);
    smoothOutline(neck);
    expect(holes(maskFor(neck)), 'no counter conjured').toBe(before);
    expect(maskFor(neck).on[3 * 5 + 2], 'the neck is left open').toBe(0);
  });

  it('holds a counter open through the whole finishing, at every size a letter is written at', () => {
    // A ring is the shape every pass can ruin: the repair can seal it, the thinning can cut it, the
    // join can close it.
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
    // Nothing in the finishing reshapes a stroke, and this is that promise as a test: a plain bar of
    // any width goes through untouched, at any width, on either axis.
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
 * WHAT THE PLACEMENT SEARCH IS WORTH, measured against something it did not place.
 *
 * The fit is a heuristic: it puts the glyph where the fewest cells sit near the threshold, which is a
 * good proxy for keeping the drawing and is not the same thing as keeping it. So the claim tested here
 * is the one the measurements support, and no more (`_stencil-metrics.ts:placementGain` reads the ink
 * a placement kept against the ink the face drew, which is the one reading no placement enters):
 * AT EVERY SIZE the fit carries more of the drawing on average than leaving the glyph centred, and it
 * wins about twice as many cells as it loses. It does NOT win every cell, and pinning that it did
 * would be pinning a coincidence — a search that optimises decisiveness will sometimes decide a cell
 * the other way from the drawing.
 */
describe('putting the glyph where the grid can hold it keeps more of the drawing', () => {
  const gains = FIXTURES.map((f) => ({ f, ...placementGain(f) }));

  it('carries more of the ink on average, at every size in the matrix', () => {
    // Measured: +0.167 at six cells, +0.056 at eight, tapering to +0.004 by thirty-two, where a cell
    // is a small enough share of a stroke that where it lands stops mattering. Sizes under the floor
    // where no phase can move (the ink fills the region) come out at exactly 0.
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
    // The cells the fit exists for, with the bars at the measured numbers rather than near them.
    // Centred, an E six cells tall puts its bars between rows and keeps a FIFTH of the ink it was
    // drawn with (0.213, and an L 0.209); fitted, both keep over nine tenths (0.908 and 0.955). The
    // bars are set a clear step inside those — 0.85 and 0.35 — so a real regression fails and a
    // hundredth of drift does not.
    for (const text of ['E', 'L']) {
      const g = gains.find((x) => x.f.text === text && x.f.height === 6)!;
      expect(g.fitted, `${text} at six, fitted`).toBeGreaterThan(0.85);
      expect(g.centred, `${text} at six, centred`).toBeLessThan(0.35);
    }
  });
});

/* ── a straight stroke comes out straight ──────────────────────────────────────────────────── */

describe('what was drawn straight is built straight', () => {
  /** The ideal itself as the reference, so the run detector sees one straight edge and the built shape
   *  is measured against the line it should be. */
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
    // A 45 degree stroke is a chain of corner touches, and every one of them has to be joined or the
    // map draws a dotted line. WHICH side the join takes is what makes the difference between a
    // staircase and a wobble: decided per cell it can flip partway down, so it is decided per run.
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
    // Each row is the diagonal's own cell plus exactly one join, all on the same side of it.
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

/**
 * THE RULE THE SHELF REFUSES A CARD ON, held against real drawn letters.
 *
 * The measurement itself needs a canvas, so what a suite can hold is the DECISION: given the numbers
 * a glyph actually comes out with, which cards a region would offer. The fixture is those numbers for
 * fourteen glyph sets at ten sizes, so the rule is exercised on the same letters the app draws.
 */
describe('a card is offered by what its own letter can do', () => {
  const verdict = (text: string, size: number): { ok: boolean; separation: number; density: number; pieces: number } => {
    const fixture = FIXTURES.find((f) => f.text === text && f.height === size)!;
    const score = scoreGlyph(fixture, buildGlyph(fixture));
    // The reading the shelf takes, from the same numbers: `fixture.pieces` is the drawing's own count
    // at full resolution, which is what the card's 4x truth gives it.
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
    // The visitor's own report was a region too small for the letters they typed. A blanket floor has
    // to answer for the hardest of them, and this is the answer for the letter in hand: at five cells
    // an E is three bars and two gaps and comes out perfect, while an M is two stems and a V in the
    // same square and fuses into a block.
    for (const letter of ['E', 'I', 'L']) {
      expect(verdict(letter, 5).ok, `${letter} at five is offered`).toBe(true);
    }
    for (const letter of ['M', 'X', 'a']) {
      expect(verdict(letter, 5).ok, `${letter} at five is refused`).toBe(false);
    }
  });

  it('refuses a WORD whose letters have run into each other, which a share cannot see', () => {
    // The hole a third bar closes. Two letters fusing costs a couple of runs out of a whole row, so
    // HELLO in a six-cell region comes back at 0.898 separation and 0.540 density — both comfortably
    // inside their bars — while arriving as three pieces of five. What a row of letters loses first
    // is the ground BETWEEN them, and that is a count of pieces rather than a proportion of runs.
    for (const size of [6, 8]) {
      const v = verdict('HELLO', size);
      expect(v.separation, `HELLO at ${size} passes the share`).toBeGreaterThan(GLYPH_LEGIBLE.separation);
      expect(v.ok, `HELLO at ${size} is refused anyway`).toBe(false);
    }
    expect(verdict('HELLO', 10).ok, 'and offered where its letters stand apart').toBe(true);
  });

  it('offers every letter once the region reaches the blanket floor', () => {
    for (const letter of ['I', 'E', 'L', 'N', 'Z', 'X', 'M', 'Q', 'z', 'a']) {
      expect(verdict(letter, 8).ok, `${letter} at eight`).toBe(true);
    }
  });

  it('reads the same two bars the matrix is judged by', () => {
    // ONE SOURCE. A card that offered what the matrix calls illegible, or refused what it passes,
    // would be two answers to one question.
    expect(GLYPH_LEGIBLE.separation).toBe(STENCIL_THRESHOLDS.separation);
    expect(GLYPH_LEGIBLE.density).toBe(STENCIL_THRESHOLDS.density);
  });
});

describe('the built letter is what the raster said, only quantised', () => {
  it('keeps the reference glyph in view: every fixture recognisable as itself', () => {
    // One reading over the whole matrix, so a change that helps one size at another's expense shows
    // up as a number rather than as one green file and one red one.
    const scores = FIXTURES.map((f) => scoreGlyph(f, buildGlyph(f)));
    const judged = scores.filter((s) => !s.underFloor);
    const legible = judged.filter((s) => s.recall >= STENCIL_THRESHOLDS.recall);
    expect(legible.length, 'matrix cells whose structure survived').toBe(judged.length);
    expect(judged.length, 'and most of the matrix is judged').toBeGreaterThan(scores.length / 2);
  });

  it('reads the raster the harness stored, not one it re-derived', () => {
    // The fixture is the shipped faces' own work. If it were ever regenerated against a different
    // stack, every number above would silently be measuring a different letter.
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
