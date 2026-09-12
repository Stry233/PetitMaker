import { describe, expect, it } from 'vitest';
import { zoneCellAt, zoneCellSet, zoneLabelAnchor } from '../../core/model/annotations';
import type { MacroCoord } from '../../core/model/types';

const rect = (x0: number, y0: number, x1: number, y1: number): MacroCoord[] => {
  const out: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};
const inside = (cells: MacroCoord[], p: { x: number; y: number }): boolean => {
  const c = zoneCellAt(p);
  return zoneCellSet(cells).has(`${c.x},${c.y}`);
};

describe('zone caption anchor', () => {
  it('stands at the middle of a rectangle', () => {
    expect(zoneLabelAnchor(rect(0, 0, 9, 5))).toEqual({ x: 4.5, y: 2.5 });
  });

  it('stays inside an L whose centroid falls in the empty corner', () => {
    const cells = [...rect(0, 0, 9, 1), ...rect(0, 2, 1, 9)];
    const at = zoneLabelAnchor(cells);
    expect(inside(cells, at)).toBe(true);
  });

  it('stays inside a ring whose centroid is the hole', () => {
    const cells = rect(0, 0, 8, 8).filter((c) => c.x < 2 || c.x > 6 || c.y < 2 || c.y > 6);
    const at = zoneLabelAnchor(cells);
    expect(inside(cells, at)).toBe(true);
  });

  it('prefers the thickest part over a thin tail', () => {
    const cells = [...rect(0, 0, 5, 5), ...rect(6, 2, 20, 2)];
    const at = zoneLabelAnchor(cells);
    expect(at.x).toBeLessThanOrEqual(5);
    expect(inside(cells, at)).toBe(true);
  });

  it('answers a single cell with its own centre', () => {
    expect(zoneLabelAnchor([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
  });
});
