/**
 * THE ARITHMETIC A GLYPH IS DRAWN BY, which is the part of the rasterizer a test can hold.
 *
 * Drawing needs a canvas and a font, so `drawGlyph` itself is exercised by the evaluation harness
 * against committed font rasters (`__tests__/tools/stencil-glyph.test.ts` over
 * `__tests__/fixtures/stencil-rasters.json`). What decides where every letter in a SMALL region
 * lands is not the drawing though — it is this arithmetic on the air the region can spare, and left
 * unpinned a change to it would pass every suite while moving every small letter.
 */
import { describe, it, expect } from 'vitest';
import { glyphFrame, glyphSurvives, judgeDrawn } from '../../../ui/shell/bars/stencil-raster';
import { textMinSide, type Stencil } from '../../../tools/generation/stencil/stencil';

const box = (w: number, h: number) => ({ width: w, height: h });

describe('the air a region can spare', () => {
  it('keeps a cell of it wherever the region has one to give', () => {
    // Two canvas pixels per cell, so a cell of air is a margin of two.
    expect(glyphFrame('E', box(6, 6))).toEqual({ cell: 2, margin: 2, mayShift: true });
    expect(glyphFrame('E', box(48, 48))).toEqual({ cell: 2, margin: 2, mayShift: true });
    expect(glyphFrame('HELLO', box(40, 8))).toEqual({ cell: 2, margin: 2, mayShift: true });
  });

  it('gives it to the glyph where a region has none to spare', () => {
    // The letter floor is above this now — eight cells, so that every letter is served and not only
    // the ones made of bars — but the rule is about the INK a glyph needs rather than about the gate,
    // and a five-cell square is exactly the E's own five rows with nothing left over.
    expect(textMinSide('E')).toBe(8);
    expect(glyphFrame('E', box(5, 5))).toEqual({ cell: 2, margin: 0, mayShift: false });
    // An ideograph asks for thirteen, so a region of exactly that gives up its air the same way.
    expect(glyphFrame('谷', box(13, 13))).toEqual({ cell: 2, margin: 0, mayShift: false });
  });

  it('will not shift a glyph it has no room to shift', () => {
    // The search spends the air to move the glyph by up to half a cell. With none, every phase but
    // the centred one pushes a sliver of stroke off the region and can only lose ink — measured at
    // five cells, searching anyway costs N 0.94 -> 0.68, Z 0.82 -> 0.60, X 0.67 -> 0.53.
    for (const side of [3, 4, 5]) expect(glyphFrame('E', box(side, side)).mayShift, `${side} cells`).toBe(false);
    for (const side of [6, 8, 20]) expect(glyphFrame('E', box(side, side)).mayShift, `${side} cells`).toBe(true);
  });

  it('asks of the REGION\'s grid, so a magnified draw is the same picture larger', () => {
    // The evaluation draws its reference four times over. Told nothing, it would find room for air a
    // five-cell region does not have and come back a different SIZE as well as a finer picture.
    const region = glyphFrame('E', box(5, 5));
    const magnified = glyphFrame('E', box(20, 20), 4);
    expect(magnified.margin, 'no air at four times a region that has none').toBe(0);
    expect(magnified.cell, 'a region cell is four times as many pixels').toBe(region.cell * 4);
    expect(glyphFrame('E', box(24, 24), 4).margin, 'and a cell of air is four times as wide')
      .toBe(glyphFrame('E', box(6, 6)).margin * 4);
  });
});

/** A stencil written out as rows, '#' being ink. */
function drawn(rows: string[]): Stencil {
  const height = rows.length, width = rows[0]!.length;
  const coverage = new Uint8Array(width * height);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { coverage[y * width + x] = ch === '#' ? 255 : 0; }));
  return { width, height, coverage, color: new Uint32Array(width * height) };
}

/** The same rows at `scale` times the resolution, which is what a DRAWING of them looks like. */
function magnified(rows: string[], scale: number): Stencil {
  const out: string[] = [];
  for (const row of rows) {
    const wide = [...row].map((ch) => ch.repeat(scale)).join('');
    for (let i = 0; i < scale; i++) out.push(wide);
  }
  return drawn(out);
}

describe('the verdict on a glyph that has been drawn', () => {
  // Everything up to the two drawings needs a canvas; everything after is arithmetic, and this is it.
  // The letters themselves are judged on committed font rasters in `tools/stencil-glyph.test.ts`.
  const SCALE = 4;

  it('refuses a picture with nothing in it', () => {
    // A region too small for the word leaves the raster empty, and an empty picture crosses none of
    // the drawing's pieces and fills none of its own box: every reading comes back perfect.
    const truth = magnified(['.###.', '.#...', '.###.', '.#...', '.###.'], SCALE);
    const verdict = judgeDrawn(drawn(['.....', '.....', '.....', '.....', '.....']), truth, SCALE);
    expect(verdict.ok).toBe(false);
    expect(verdict.pieces).toBe(0);
  });

  it('offers a letter whose strokes are still apart', () => {
    const rows = ['.###.', '.#...', '.###.', '.#...', '.###.'];
    const verdict = judgeDrawn(drawn(rows), magnified(rows, SCALE), SCALE);
    expect(verdict.ok).toBe(true);
    expect(verdict.separation).toBe(1);
    expect(verdict.pieces).toBe(verdict.wholePieces);
  });

  it('refuses one whose strokes have run together', () => {
    // The same E as a block: one piece still, one counter still, and every gap gone.
    const truth = magnified(['.###.', '.#...', '.###.', '.#...', '.###.'], SCALE);
    const verdict = judgeDrawn(drawn(['.###.', '.###.', '.###.', '.###.', '.###.']), truth, SCALE);
    expect(verdict.ok).toBe(false);
    expect(verdict.separation).toBeLessThan(0.7);
  });

  it('refuses one whose PIECES have run together, which a share cannot see', () => {
    // Two letters side by side, touching along one row. THE OTHER TWO BARS PASS: nearly every row and
    // column still crosses what it did (0.875 separation) and the shape is under the density bar
    // (0.778), so this case is the pieces bar alone — take it out and the fusion is offered.
    const truth = magnified(['#.#', '#.#', '#.#'], SCALE);
    const verdict = judgeDrawn(drawn(['###', '#.#', '#.#']), truth, SCALE);
    expect(verdict.wholePieces).toBe(2);
    expect(verdict.pieces).toBe(1);
    expect(verdict.separation, 'the share is well inside its bar').toBeGreaterThan(0.7);
    expect(verdict.density, 'and so is the ink').toBeLessThanOrEqual(0.8);
    expect(verdict.ok).toBe(false);
  });

  it('asks for density only where the drawing gave more than one stroke', () => {
    // A bare stem fills its own box by definition, so the bar that catches a slab must not catch it.
    const rows = ['.#.', '.#.', '.#.'];
    const verdict = judgeDrawn(drawn(rows), magnified(rows, SCALE), SCALE);
    expect(verdict.density).toBe(1);
    expect(verdict.multiStroke).toBe(false);
    expect(verdict.ok).toBe(true);
  });

  it('says nothing at all without a drawing surface, which is a refusal', () => {
    // The real line, not a stand-in for it: jsdom has no 2D context, so this is what the shelf's
    // gates get here. No measurement means the blanket floor stands, and the caller has already found
    // the region short of it — an E in five cells is offered in a browser and refused here.
    expect(glyphSurvives('E', { origin: { x: 0, y: 0 }, width: 5, height: 5 }).ok).toBe(false);
  });
});
