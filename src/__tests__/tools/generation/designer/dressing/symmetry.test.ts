// The mirror operator. What it must guarantee is that whatever comes out of it scores a PERFECT
// mirror under the evaluation's own reading — a plant matching the same species at the mirrored
// cell — because a composition that is nearly symmetric reads as a mistake rather than as a
// composition.
import { describe, it, expect } from 'vitest';
import { makeRng } from '../../../../../core/model/rng';
import { mirrorScore } from '../../../../../tools/generation/designer/eval';
import {
  composesFormally, mirrorOf, reflect, symmetrize, type Mark,
} from '../../../../../tools/generation/designer/dressing/symmetry';

const all = (): boolean => true;
const marks = (...cells: [number, number, string][]): Mark[] =>
  cells.map(([x, y, catalogId]) => ({ x, y, catalogId }));

describe('the mirror line', () => {
  it('runs through the box and keeps a cell inside it', () => {
    const m = mirrorOf({ x: 10, y: 4, w: 7, h: 5 }, 'v');
    const back = reflect(m, 10, 4);
    expect(back.x).toBeGreaterThanOrEqual(10);
    expect(back.x).toBeLessThan(17);
    expect(back.y).toBe(4);
  });

  it('preserves a cell\'s parity, so a step-2 lattice mirrors onto its own phase', () => {
    for (const w of [5, 6, 7, 8, 9]) {
      const m = mirrorOf({ x: 3, y: 0, w, h: 4 }, 'v');
      expect(reflect(m, 4, 0).x % 2, `w=${w}`).toBe(0);
      expect(reflect(m, 5, 0).x % 2, `w=${w}`).toBe(1);
    }
  });

  it('flips y on the horizontal axis and x on the vertical one', () => {
    const box = { x: 0, y: 0, w: 5, h: 5 };
    expect(reflect(mirrorOf(box, 'h'), 1, 0)).toEqual({ x: 1, y: 4 });
    expect(reflect(mirrorOf(box, 'v'), 0, 1)).toEqual({ x: 4, y: 1 });
  });
});

describe('symmetrize', () => {
  it('emits both halves of every pair it keeps', () => {
    const m = mirrorOf({ x: 0, y: 0, w: 5, h: 3 }, 'v');
    const out = symmetrize(marks([0, 0, 'a'], [1, 1, 'b']), m, all);
    expect(out).toHaveLength(4);
    expect(out.filter((k) => k.catalogId === 'a').map((k) => k.x).sort()).toEqual([0, 4]);
  });

  it('emits a mark on the axis once', () => {
    const m = mirrorOf({ x: 0, y: 0, w: 5, h: 3 }, 'v');
    expect(symmetrize(marks([2, 1, 'a']), m, all)).toHaveLength(1);
  });

  it('drops a mark whose reflection cannot be planted, rather than leaving half a pair', () => {
    const m = mirrorOf({ x: 0, y: 0, w: 5, h: 3 }, 'v');
    const out = symmetrize(marks([0, 0, 'a']), m, (x) => x !== 4);
    expect(out).toEqual([]);
  });

  it('drops a mark whose reflection is spoken for by another species', () => {
    const m = mirrorOf({ x: 0, y: 0, w: 5, h: 3 }, 'v');
    const out = symmetrize(marks([0, 0, 'a'], [4, 0, 'b']), m, all);
    expect(out).toEqual([]);
  });

  it('scores a perfect mirror under the evaluation\'s own reading', () => {
    const m = mirrorOf({ x: 0, y: 0, w: 9, h: 7 }, 'v');
    const raw: Mark[] = [];
    for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) {
      raw.push({ x, y, catalogId: (x + y) % 3 === 0 ? 'flower-rose' : 'flower-lily' });
    }
    const out = symmetrize(raw, m, all);
    expect(mirrorScore(out.map((k) => ({ x: k.x, y: k.y, id: k.catalogId }))).v).toBe(1);
  });
});

describe('formal share', () => {
  it('composes about the share of runs it is asked for', () => {
    const rng = makeRng(12345);
    let formal = 0;
    for (let i = 0; i < 400; i++) if (composesFormally(rng, 0.45)) formal++;
    expect(formal / 400).toBeGreaterThan(0.35);
    expect(formal / 400).toBeLessThan(0.55);
  });
});
