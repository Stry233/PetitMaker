/** Canvas-free checks for the text rasterizer and its legibility readings. */
import { describe, it, expect } from 'vitest';
import { glyphFrame, glyphSurvives } from '../../../../tools/generation/stencil/stencil-raster';
import { judgeDrawn } from '../../../../tools/generation/stencil/stencil-verdict';
import { textMinBox, type Stencil } from '../../../../tools/generation/stencil/stencil';

const box = (w: number, h: number) => ({ width: w, height: h });

describe('the air a region can spare', () => {
  it('keeps a cell of it wherever the region has one to give', () => {
    // Two canvas pixels per cell, so a cell of air is a margin of two.
    expect(glyphFrame('E', box(6, 6))).toEqual({ cell: 2, margin: 2, mayShift: true });
    expect(glyphFrame('E', box(48, 48))).toEqual({ cell: 2, margin: 2, mayShift: true });
    expect(glyphFrame('HELLO', box(40, 8))).toEqual({ cell: 2, margin: 2, mayShift: true });
  });

  it('gives it to the glyph where a region has none to spare', () => {
    // Below the eight-cell letter floor, a five-cell square is exactly the E's five rows.
    expect(textMinBox('E').height).toBe(8);
    expect(glyphFrame('E', box(5, 5))).toEqual({ cell: 2, margin: 0, mayShift: false });
    // An ideograph asks for thirteen, so a region of exactly that gives up its air the same way.
    expect(glyphFrame('谷', box(13, 13))).toEqual({ cell: 2, margin: 0, mayShift: false });
  });

  it('will not shift a glyph it has no room to shift', () => {
    // The search spends the air to move the glyph by up to half a cell; with none, every phase but the
    // centred one pushes stroke off the region and can only lose ink.
    for (const side of [3, 4, 5]) expect(glyphFrame('E', box(side, side)).mayShift, `${side} cells`).toBe(false);
    for (const side of [6, 8, 20]) expect(glyphFrame('E', box(side, side)).mayShift, `${side} cells`).toBe(true);
  });

  it('asks of the REGION\'s grid, so a magnified draw is the same picture larger', () => {
    // The evaluation draws its reference at four times the resolution.
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

/** The same rows at `scale` times the resolution, which is what a drawing of them looks like. */
function magnified(rows: string[], scale: number): Stencil {
  const out: string[] = [];
  for (const row of rows) {
    const wide = [...row].map((ch) => ch.repeat(scale)).join('');
    for (let i = 0; i < scale; i++) out.push(wide);
  }
  return drawn(out);
}

describe('the verdict on a glyph that has been drawn', () => {
  // Real letters are judged on committed font rasters in `stencil-glyph.test.ts`.
  const SCALE = 4;

  it('refuses a picture with nothing in it', () => {
    // A region too small for the word leaves the raster empty, and every ratio reading comes back perfect.
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
    // Two letters touching along one row pass the separation and density bars; only the pieces bar refuses.
    const truth = magnified(['#.#', '#.#', '#.#'], SCALE);
    const verdict = judgeDrawn(drawn(['###', '#.#', '#.#']), truth, SCALE);
    expect(verdict.wholePieces).toBe(2);
    expect(verdict.pieces).toBe(1);
    expect(verdict.separation, 'the share is well inside its bar').toBeGreaterThan(0.7);
    expect(verdict.density, 'and so is the ink').toBeLessThanOrEqual(0.8);
    expect(verdict.ok).toBe(false);
  });

  it('asks for density only where the drawing gave more than one stroke', () => {
    // A bare stem fills its own box by definition.
    const rows = ['.#.', '.#.', '.#.'];
    const verdict = judgeDrawn(drawn(rows), magnified(rows, SCALE), SCALE);
    expect(verdict.density).toBe(1);
    expect(verdict.multiStroke).toBe(false);
    expect(verdict.ok).toBe(true);
  });

  it('refuses an unmeasurable outline without a drawing surface', () => {
    expect(glyphSurvives('谷', { origin: { x: 0, y: 0 }, width: 5, height: 5 }).ok).toBe(false);
  });
});
