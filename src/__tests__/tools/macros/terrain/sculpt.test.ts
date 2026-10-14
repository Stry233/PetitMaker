import { describe, expect, it } from 'vitest';
import { makeState } from '../../../_support/map-state';
import { sculptTerrace, sculptWall, sinkPoolCourt, wallRectAtEdge } from '../../../../tools/macros/terrain/sculpt';
import { figureCells, figureRing } from '../../../../tools/macros/terrain/figures';
import { cellKey } from '../../../../core/grid/rect';
import { BASE_SUPPORT } from '../../../../core/game/profile';
import { CommandType, TerrainType, type PaintTerrainCommand } from '../../../../core/model/types';

const keys = (cells: readonly { x: number; y: number }[]) => new Set(cells.map((c) => cellKey(c.x, c.y)));

describe('sculptTerrace', () => {
  it('stands every upper tier inside the strict interior of the tier below', () => {
    const state = makeState(40, 40);
    const t = sculptTerrace(state, { cx: 20, cy: 20, baseRadius: 10, tiers: 3, seed: 7 }, (c) => c, null);
    expect(t.tiers.length).toBeGreaterThan(1);
    for (let L = 1; L < t.tiers.length; L++) {
      const below = keys(t.tiers[L - 1]!);
      for (const c of t.tiers[L]!) {
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(below.has(cellKey(c.x + dx, c.y + dy))).toBe(true);
      }
    }
    expect(t.clipped).toBe(false);
  });

  it('replays the same shape for the same seed and reports a region clip', () => {
    const state = makeState(40, 40);
    const spec = { cx: 20, cy: 20, baseRadius: 8, tiers: 2, seed: 11 };
    expect(sculptTerrace(state, spec, (c) => c, null).tiers).toEqual(sculptTerrace(state, spec, (c) => c, null).tiers);
    const half = new Set<string>();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) half.add(cellKey(x, y));
    const clipped = sculptTerrace(state, spec, (c) => c, half);
    expect(clipped.clipped).toBe(true);
    expect(clipped.tiers.flat().every((c) => c.x < 20)).toBe(true);
  });
});

describe('sculptWall', () => {
  it('steps bands one support reach apart, each inset 2 cells, and pools inside the crest rim', () => {
    const state = makeState(40, 40);
    const wall = sculptWall(state, { x1: 2, y1: 2, x2: 20, y2: 20 }, 2 * BASE_SUPPORT.reach, true, null)!;
    expect(wall.bands).toEqual([BASE_SUPPORT.reach, 2 * BASE_SUPPORT.reach]);
    expect(wall.crest).toBe(2 * BASE_SUPPORT.reach);
    const top = wall.commands.filter((c): c is PaintTerrainCommand => c.type === CommandType.PaintTerrain && c.terrainType === TerrainType.Mountain).at(-1)!;
    expect(Math.min(...top.cells.map((c) => c.x))).toBe(wall.base.reduce((m, c) => Math.min(m, c.x), Infinity) + 2);
    expect(wall.poolCells.length).toBeGreaterThan(0);
  });

  it('sites a wall along a map edge of the buildable ground', () => {
    const state = makeState(30, 20);
    expect(wallRectAtEdge(state, 'N', 7)).toEqual({ x1: 0, x2: 29, y1: 0, y2: 6 });
    expect(wallRectAtEdge(state, 'E', 7)).toEqual({ x1: 23, x2: 29, y1: 0, y2: 19 });
  });
});

describe('sinkPoolCourt', () => {
  it('holds water inside a 1-cell rim and leaves the islet lattice dry', () => {
    const court = sinkPoolCourt({ x1: 1, y1: 1, x2: 11, y2: 11 }, 1, true, null)!;
    const water = keys(court.water);
    expect(water.has(cellKey(1, 5))).toBe(false);
    expect(water.has(cellKey(3, 3))).toBe(false);
    expect(water.has(cellKey(4, 4))).toBe(true);
    expect(court.islets).toBe(9);
  });
});

describe('figures', () => {
  it('draws a mirror-symmetric heart and a ring around it', () => {
    const heart = figureCells('heart', 20, 20, 16);
    const set = keys(heart);
    for (const c of heart) expect(set.has(cellKey(40 - c.x, c.y))).toBe(true);
    const ring = keys(figureRing(heart, 'heart', 20, 3.2));
    for (const k of ring) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      expect(ring.has(cellKey(40 - x, y))).toBe(true);
      expect(set.has(k)).toBe(false);
    }
  });
});
