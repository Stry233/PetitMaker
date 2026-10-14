/** The grid conversions answer what the hand-written spellings they replace answered. */
import { describe, expect, it } from 'vitest';
import { cellOverlapsRect, rectsOverlap } from '../../../core/grid/rect';
import { footprintTerrain, terrainCellsUnder } from '../../../core/grid/footprint';
import { cellAtPoint } from '../../../core/grid/pointer';
import { point } from '../../_support/grid';
import { terrainCellAt, terrainCellRect } from '../../../core/grid/grid-convert';

const RECTS = [
  { x: 3, y: 4, w: 2, h: 1 }, { x: 3.5, y: 4, w: 2, h: 3 }, { x: 0.5, y: 0.5, w: 20, h: 27 }, { x: 7, y: 2.5, w: 1, h: 1 },
  { x: -2.5, y: -1, w: 3, h: 2.5 },
];
const keys = (cells: { x: number; y: number }[]): string[] => cells.map((c) => `${c.x},${c.y}`).sort();

describe('the terrain cells under a footprint', () => {
  it('are the cells a terrain-shifted overlap scan finds', () => {
    for (const r of RECTS) {
      const scan: { x: number; y: number }[] = [];
      for (let y = Math.floor(r.y - 0.5); y <= Math.ceil(r.y + r.h + 0.5); y++) {
        for (let x = Math.floor(r.x - 0.5); x <= Math.ceil(r.x + r.w + 0.5); x++) if (cellOverlapsRect(r, x, y, 'terrain')) scan.push({ x, y });
      }
      const f = footprintTerrain(r);
      const rect: { x: number; y: number }[] = [];
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) rect.push({ x, y });
      expect(keys(terrainCellsUnder(r))).toEqual(keys(scan));
      expect(keys(rect)).toEqual(keys(scan));
    }
  });
});

describe('a terrain cell rect', () => {
  it('overlaps exactly the footprints a terrain-shifted overlap test accepts', () => {
    for (const r of RECTS) for (let y = -4; y < 32; y++) for (let x = -4; x < 26; x++) {
      expect(rectsOverlap(r, terrainCellRect({ x, y }))).toBe(cellOverlapsRect(r, x, y, 'terrain'));
    }
  });
});

describe('the terrain cell under a point', () => {
  // A terrain cell is centred on a whole map unit, so cell n spans [n - 0.5, n + 0.5).
  it.each([
    [-2.5, -2], [-1.5, -1], [-1, -1], [-0.75, -1], [-0.5, 0], [-0.25, 0], [0, 0], [0.25, 0],
    [0.4999, 0], [0.5, 1], [0.75, 1], [1, 1], [1.4999, 1], [1.5, 2], [2.25, 2],
  ])('puts map coordinate %d in terrain cell %d', (at, cell) => {
    expect(terrainCellAt(at, at)).toEqual({ x: cell, y: cell });
    expect(terrainCellAt(at, -at).x).toBe(cell);
    expect(cellAtPoint(point({ x: at, y: at }), 'terrain')).toMatchObject({ x: cell, y: cell });
  });
});
