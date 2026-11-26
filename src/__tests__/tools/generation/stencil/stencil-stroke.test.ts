/**
 * How thick a letter's strokes come out, which decides whether a small region can carry text. Font
 * weight, chosen from the room the glyph gets, is the only control: at one heavy weight an E in a
 * modest region comes out four cells thick with both counters closed, and nothing reshapes the strokes
 * afterwards (`stencil-glyph.test.ts` measures why).
 */
import { describe, it, expect } from 'vitest';
import type { Stencil } from '../../../../tools/generation/stencil/stencil';
import { covered } from '../../../../tools/generation/stencil/stencil';
import { finishGlyph, GLYPH_WEIGHTS, glyphWeight, restoreStructure, type GlyphSource } from '../../../../tools/generation/stencil/stencil-stroke';
import { glyphExtent } from '../../../../tools/generation/stencil/stencil-stem';
import { components, holes, strokeTarget } from './_stencil-metrics';

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
    // The face ships two instances and the heavier is a slab on this grid: it turns an eight-cell M into
    // a solid block and inks half a large region where the lighter inks a third.
    for (const n of [8, 12, 20, 32, 56, 96]) expect(glyphWeight('E', box(n, n)), `${n} cells`).toBe(500);
  });

  it('reaches for the heavier instance only where the lighter draws under a cell', () => {
    // Regions this small are refused, but the rule still holds: at five cells the lighter instance draws
    // 0.46 of a cell and an E loses its middle bar.
    expect(glyphWeight('E', box(5, 5))).toBe(700);
    expect(glyphWeight('E', box(6, 6))).toBe(700);
    expect(glyphWeight('E', box(8, 8)), 'and stops as soon as three quarters of a cell is drawn').toBe(500);
  });

  it('only ever names a weight the shipped face actually draws', () => {
    // The table is measured from the shipped face, and asking between its two Latin instances draws
    // one of them anyway.
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

  it('starts a dense script lighter than a Latin letter, where the room is tightest', () => {
    // A Han glyph packs seven stroke rows into the square an E spends on three, so open counters
    // matter more than weight, most of all at the small end.
    expect(strokeTarget('谷地', box(24, 12))).toBeLessThanOrEqual(strokeTarget('EF', box(24, 12)));
    // At the large end the curves are not ordered by script: the Latin curve tops out at the one
    // instance the grid can hold.
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
  it('leaves a bar of any width exactly as drawn', () => {
    for (const width of [1, 2, 3, 6]) {
      const rows = Array.from({ length: width + 4 }, () => '.'.repeat(2) + '#'.repeat(width) + '..');
      const s = stencilOf(rows);
      finishGlyph(s);
      expect(draw(s), `${width} cells wide`).toEqual(rows);
    }
  });
});

const PER = 4;

/** A font drawing at four pixels to a cell, from rectangles [x0, y0, x1, y1) in its pixels. */
function sourceOf(cols: number, rows: number, rects: [number, number, number, number][]): GlyphSource {
  const width = cols * PER, height = rows * PER, on = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) on[y * width + x] = 1;
  const cell = Int32Array.from({ length: width * height }, (_, i) => Math.floor(Math.floor(i / width) / PER) * cols + Math.floor(i % width / PER));
  return { width, height, on, cell };
}

/** The cells the drawing covers, each holding its share of the drawing's pixels. */
function cellsOf(source: GlyphSource): Stencil {
  const width = source.width / PER, height = source.height / PER;
  const coverage = new Uint8Array(width * height);
  source.on.forEach((v, i) => { coverage[source.cell[i]!]! += v; });
  for (let i = 0; i < coverage.length; i++) coverage[i] = Math.round(coverage[i]! * 255 / (PER * PER));
  return { width, height, coverage, color: new Uint32Array(width * height) };
}

const maskOfStencil = (s: Stencil) => ({ width: s.width, height: s.height, on: Uint8Array.from(s.coverage, v => v >= 128 ? 1 : 0) });

describe('a joint or counter thinner than a cell keeps the font\'s structure', () => {
  it('bridges a hairline joint the grid parts with the fewest cells along it', () => {
    // Two stems joined by a one-pixel hairline: a quarter of each cell it crosses, so the cells part.
    const source = sourceOf(7, 5, [[0, 0, 8, 20], [20, 0, 28, 20], [8, 9, 20, 10]]);
    const s = cellsOf(source);
    expect(components(maskOfStencil(s), 8)).toBe(2);
    expect(restoreStructure(s, source, { pieces: 1, counters: 0 })).toBe(3);
    expect(draw(s)).toEqual(['##...##', '##...##', '#######', '##...##', '##...##']);
  });

  it('joins a parted body without joining a detached mark that grazes it', () => {
    // A body parted at a hairline, and a dot whose cells also hold a few pixels of a spur off the body.
    const source = sourceOf(7, 7, [[0, 16, 12, 28], [16, 16, 28, 28], [12, 21, 16, 22], [12, 2, 13, 16], [14, 1, 16, 7]]);
    const s = cellsOf(source);
    expect(components(maskOfStencil(s), 8)).toBe(3);
    restoreStructure(s, source, { pieces: 2, counters: 0 });
    expect(components(maskOfStencil(s), 8)).toBe(2);
    expect(draw(s)).toEqual(['...#...', '...#...', '.......', '.......', '###.###', '#######', '###.###']);
  });

  it('reopens a counter the cells filled without parting the ring', () => {
    // A small counter in the middle of a thick square: three quarters of its cell stay inked.
    const source = sourceOf(5, 5, [[0, 0, 20, 9], [0, 11, 20, 20], [0, 9, 9, 11], [11, 9, 20, 11]]);
    const s = cellsOf(source);
    expect(holes(maskOfStencil(s))).toBe(0);
    expect(restoreStructure(s, source, { pieces: 1, counters: 1 })).toBe(1);
    expect(draw(s)).toEqual(['#####', '#####', '##.##', '#####', '#####']);
    expect(components(maskOfStencil(s), 8)).toBe(1);
  });

  it('changes nothing when the cells already hold the structure', () => {
    const source = sourceOf(7, 5, [[0, 0, 8, 20], [20, 0, 28, 20]]);
    const s = cellsOf(source), before = draw(s);
    expect(restoreStructure(s, source, { pieces: 2, counters: 0 })).toBe(0);
    expect(draw(s)).toEqual(before);
  });
});
