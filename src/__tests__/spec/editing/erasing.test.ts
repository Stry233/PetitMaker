/** The erasers: each takes only its own surface, a layer at a time, one gesture one undo step. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world } from '../_world';
import { brush, eraser, objectsOf, plateau } from './_editing';
import type { MacroCoord } from '../../../core/model/types';

const ROAD = 'path-overgrown-dirt';
const east = (c: MacroCoord, dx: number): MacroCoord => ({ x: c.x + dx, y: c.y });

describe('erasing', () => {
  spec('EDIT-11', 'the mountain eraser lowers a cell one layer per stroke, however often the stroke crosses it, and skips water', () => {
    const w = world();
    const at = w.openGround(8, 3);
    const row = { x: at.x, y: at.y + 1 };
    plateau(w, row, 3, 1, 2);
    brush(w, { contentType: 'water' }).click(east(row, 4));
    expect(w.terrainAt(east(row, 4))).toEqual({ type: TerrainType.Water, elevation: 0 });
    const before = w.fingerprint();

    const e = eraser(w);
    e.drag(row, east(row, 2), row, east(row, 4), east(row, 1));
    expect(e.toasts).toEqual([]);
    for (const dx of [0, 1, 2]) expect(w.terrainAt(east(row, dx)), `cell ${dx}`).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(w.terrainAt(east(row, 4)), 'the water stays').toEqual({ type: TerrainType.Water, elevation: 0 });

    expect(w.undo()).toBe(true);
    expect(w.fingerprint(), 'the whole gesture is one undo step').toBe(before);
  });

  spec('EDIT-11', 'the water eraser takes water and skips mountain', () => {
    const w = world();
    const at = w.openGround(6, 3);
    const row = { x: at.x, y: at.y + 1 };
    plateau(w, row, 2, 1, 1);
    brush(w, { contentType: 'water' }).drag(east(row, 3), east(row, 4));
    eraser(w, { contentType: 'water' }).drag(row, east(row, 4));
    expect(w.terrainAt(row)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(w.terrainAt(east(row, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(w.terrainAt(east(row, 3))).toBeNull();
    expect(w.terrainAt(east(row, 4))).toBeNull();
  });

  spec('EDIT-11', 'the road eraser lifts road tiles and leaves the terrain beneath', () => {
    const w = world();
    const at = w.openGround(6, 6);
    plateau(w, at, 6, 6, 1);
    const road = { x: at.x + 2, y: at.y + 2 };
    brush(w, { contentType: 'road', tileMaterial: ROAD }).drag(road, east(road, 2));
    expect(objectsOf(w, ROAD)).toHaveLength(3);
    const ground = rect(at, 6, 6).map((c) => w.terrainAt(c));

    eraser(w, { contentType: 'road', tileMaterial: ROAD }).drag(road, east(road, 2));
    expect(objectsOf(w, ROAD)).toEqual([]);
    expect(rect(at, 6, 6).map((c) => w.terrainAt(c))).toEqual(ground);
  });

  spec('EDIT-12', 'the water eraser turns raised water into mountain at its level, and ground water into grass', () => {
    const w = world();
    const at = w.openGround(8, 5);
    plateau(w, at, 5, 5, 2);
    const pool = { x: at.x + 2, y: at.y + 2 };
    const puddle = { x: at.x + 7, y: at.y + 2 };
    const water = brush(w, { contentType: 'water' });
    water.click(pool);
    water.click(puddle);
    expect(w.terrainAt(pool)).toEqual({ type: TerrainType.Water, elevation: 2 });
    expect(w.terrainAt(puddle)).toEqual({ type: TerrainType.Water, elevation: 0 });

    const e = eraser(w, { contentType: 'water' });
    e.click(pool);
    e.click(puddle);
    expect(w.terrainAt(pool)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    expect(w.terrainAt(puddle)).toBeNull();
  });
});
