/**
 * How thick a letter's strokes come out, which is what decides whether a small region can carry
 * text at all.
 *
 * WEIGHT FOLLOWS THE ROOM the glyph is given — thin in a small region, bold in a large one — and it is
 * the WHOLE of the control. Drawn at one heavy weight, an E in a modest region arrives four cells thick
 * with both counters closed up; a quantised letter has one honest way to be lighter, and reshaping the
 * strokes afterwards costs more than it buys (`stencil-glyph.test.ts` measures that).
 */
import { describe, it, expect } from 'vitest';
import type { Stencil } from '../../../../tools/generation/stencil/stencil';
import { covered } from '../../../../tools/generation/stencil/stencil';
import { finishGlyph, GLYPH_WEIGHTS, glyphExtent, glyphWeight, strokeTarget } from '../../../../tools/generation/stencil/stencil-stroke';

function stencilOf(rows: string[]): Stencil {
  const height = rows.length, width = rows[0]!.length;
  const coverage = new Uint8Array(width * height);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { coverage[y * width + x] = ch === '.' ? 0 : 255; }));
  return { width, height, coverage, color: new Uint32Array(width * height) };
}

function draw(s: Stencil): string[] {
  const out: string[] = [];
  for (let y = 0; y < s.height; y++) {
    let row = '';
    for (let x = 0; x < s.width; x++) row += covered(s, x, y) ? '#' : '.';
    out.push(row);
  }
  return out;
}

const box = (w: number, h: number) => ({ width: w, height: h });

describe('the room one glyph gets', () => {
  it('is the shorter side, shared out between the characters', () => {
    expect(glyphExtent('A', box(40, 40))).toBeCloseTo(39, 0);
    expect(glyphExtent('ABCD', box(40, 40))).toBeCloseTo(39 / 4, 0);
    expect(glyphExtent('A', box(40, 12))).toBeCloseTo(11, 0);
  });
});

describe('stroke weight follows the room, thin to bold', () => {
  it('draws the one Latin instance the grid can hold, at every size a region is worth writing in', () => {
    // THE FACE SHIPS TWO, and the heavier one is a slab on this grid: measured over the matrix it takes
    // an M at eight cells from a readable letter to a solid block and puts half a large region under ink
    // where the lighter one puts a third. So "bold in a large region" is as bold as this face goes.
    for (const n of [8, 12, 20, 32, 56, 96]) expect(glyphWeight('E', box(n, n)), `${n} cells`).toBe(500);
  });

  it('reaches for the heavier instance only where the lighter draws under a cell', () => {
    // Below the floor a region is refused, but the rule still has to hold there: at five cells the
    // lighter instance draws 0.46 of a cell and an E arrives with no middle bar at all.
    expect(glyphWeight('E', box(5, 5))).toBe(700);
    expect(glyphWeight('E', box(6, 6))).toBe(700);
    expect(glyphWeight('E', box(8, 8)), 'and stops as soon as three quarters of a cell is drawn').toBe(500);
  });

  it('only ever names a weight the shipped face actually draws', () => {
    // The table is measured, not nominal (`--calibrate`), and the Latin face ships two instances:
    // asking for anything between them draws one of the two anyway, so a derivation that believed in
    // a ladder of nine was reading a number the face would not honour.
    for (const text of ['E', 'PETIT', '谷地']) {
      for (const n of [8, 12, 20, 32, 48, 96]) {
        expect(GLYPH_WEIGHTS).toContain(glyphWeight(text, box(n, n)));
      }
    }
  });

  it('never leaves the range a font can be asked for', () => {
    for (const n of [4, 8, 12, 16, 20, 32, 48, 80, 160]) {
      const w = glyphWeight('PETIT', box(n, n));
      expect(w).toBeGreaterThanOrEqual(100);
      expect(w).toBeLessThanOrEqual(900);
      expect(w % 100).toBe(0);
    }
  });

  it('never changes again once a stroke fits, so no size is drawn heavier than its neighbour', () => {
    for (let n = 8; n <= 96; n += 2) expect(glyphWeight('E', box(n, n)), `${n} cells`).toBe(500);
  });

  it('goes HEAVY where the light instance would draw under a cell', () => {
    // The one place the curve is not followed, and the reason a small region works at all. A cell is
    // on or off: at six cells the lightest Latin instance draws a bar a bit over half a cell, which
    // lands as two rows of half coverage and vanishes at the threshold. The heavier instance draws
    // one the grid can hold, so it wins however light the curve wanted the letter.
    expect(glyphWeight('E', box(6, 6))).toBe(700);
    expect(glyphWeight('E', box(8, 8)), 'and stops as soon as three quarters of a cell is drawn').toBe(500);
    // The stem the chosen weight draws, in cells of the region: never under three quarters of one at
    // any size a floor serves, for either script, and the heaviest the face ships where even that
    // cannot reach it.
    for (const [text, cap, stems] of [
      ['E', 0.700, { 500: 0.0800, 700: 0.1250 }],
      ['谷', 0.775, { 400: 0.0750, 500: 0.0900, 700: 0.1100, 900: 0.1350 }],
    ] as [string, number, Record<number, number>][]) {
      for (let n = 6; n <= 96; n += 2) {
        const stem = stems[glyphWeight(text, box(n, n))]!;
        const heaviest = Math.max(...Object.values(stems));
        const extent = glyphExtent(text, box(n, n));
        if (extent * heaviest / cap >= 0.75) {
          expect(extent * stem / cap, `${text} at ${n}`).toBeGreaterThanOrEqual(0.75);
        } else {
          expect(stem, `${text} at ${n} takes the heaviest there is`).toBe(heaviest);
        }
      }
    }
  });

  it('starts a dense script lighter than a Latin letter, where the room is tightest', () => {
    // A 谷 packs seven stroke rows into the square an E spends on three, so it needs its counters kept
    // open far more than it needs weight — and the small end is where that decides anything.
    expect(strokeTarget('谷地', box(24, 12))).toBeLessThanOrEqual(strokeTarget('EF', box(24, 12)));
    // At the large end the two curves are NOT ordered by script, and that is the Latin face's doing
    // rather than a decision about ideographs: its curve tops out at the one instance the grid can hold,
    // which is lighter than where the dense curve legitimately goes.
    expect(strokeTarget('E', box(56, 56)) / 55).toBeLessThanOrEqual(0.14);
    expect(strokeTarget('谷', box(56, 56)) / 55).toBeLessThanOrEqual(0.14);
  });
});

describe('the stroke target a region can carry', () => {
  it('is one or two cells in a small region and grows with it', () => {
    expect(strokeTarget('E', box(10, 10))).toBe(1);
    expect(strokeTarget('E', box(16, 16))).toBeLessThanOrEqual(2);
    expect(strokeTarget('E', box(20, 20))).toBeLessThanOrEqual(3);
    expect(strokeTarget('E', box(48, 48))).toBeGreaterThan(4);
  });

  it('is at least one cell, whatever the region', () => {
    expect(strokeTarget('E', box(2, 2))).toBe(1);
    expect(strokeTarget('PETIT!', box(6, 6))).toBe(1);
  });

  it('has no opinion about a picture: an emoji is not made of strokes', () => {
    expect(strokeTarget('🌸', box(24, 24))).toBe(0);
  });
});

describe('nothing reshapes what the face drew', () => {
  it('has no pass left that could: the target is a number, not an operation', () => {
    // `finishGlyph` takes a stencil and nothing else, so no text and no box can ask it to thin a
    // stroke: the target is applied when the face is rasterized, and nothing after that touches it.
    expect(finishGlyph.length, 'finishing takes the picture alone').toBe(1);
  });

  it('leaves a bar of any width exactly as drawn', () => {
    for (const width of [1, 2, 3, 6]) {
      const rows = Array.from({ length: width + 4 }, () => '.'.repeat(2) + '#'.repeat(width) + '..');
      const s = stencilOf(rows);
      finishGlyph(s);
      expect(draw(s), `${width} cells wide`).toEqual(rows);
    }
  });
});
