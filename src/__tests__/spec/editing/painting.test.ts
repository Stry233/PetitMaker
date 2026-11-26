/** Painting terrain and water with the brush, as a person presses, drags and releases it. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { brush, eraser, heldCells, plateau } from './_editing';
import type { MacroCoord } from '../../../core/model/types';

const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });

/** Whether `keys` form one edge-connected patch. */
function edgeConnected(keys: Set<string>): boolean {
  const [first] = keys;
  if (!first) return false;
  const seen = new Set([first]);
  const queue = [first];
  while (queue.length) {
    const [x, y] = queue.pop()!.split(',').map(Number) as [number, number];
    for (const n of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
      if (keys.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen.size === keys.size;
}

/** A first cell, left to right, whose row from it runs off grass onto the coast within `span` cells. */
function coastRow(w: SpecWorld, span: number): MacroCoord {
  const y = Math.floor(w.state.cells.length / 2);
  const row = w.state.cells[y]!;
  const grass = row[Math.floor(row.length / 2)]!.zone;
  const x = row.findIndex((c, i) => i > 0 && c.zone === grass && row[i - 1]!.zone !== grass);
  return { x: x - Math.floor(span / 2), y };
}

describe('painting terrain and water', () => {
  spec('EDIT-01', 'the brush and the eraser draw freehand, line, curve, rectangle and circle', () => {
    for (const shape of ['free', 'line', 'curve', 'rect', 'circle'] as const) {
      const w = world();
      const at = w.openGround(8, 8);
      const area = rect(at, 8, 8);
      const draw = (p: ReturnType<typeof brush>) => {
        if (shape === 'curve') { p.click(shift(at, 1, 1)); p.click(shift(at, 5, 4)); p.doubleClick(shift(at, 5, 4)); }
        else p.drag(shift(at, 1, 1), shift(at, 3, 2), shift(at, 5, 4));
      };
      draw(brush(w, { shape }));
      const laid = heldCells(w, area);
      expect(laid.size, `${shape} brush`).toBeGreaterThan(1);
      w.stroke(area, TerrainType.Mountain, 1);
      draw(eraser(w, { eraserShape: shape }));
      expect(heldCells(w, area).size, `${shape} eraser`).toBeLessThan(area.length);
    }
  });

  spec('EDIT-01', 'lays a line, rectangle or circle only on release, where the drag ended', () => {
    for (const shape of ['line', 'rect', 'circle'] as const) {
      const w = world();
      const at = w.openGround(10, 10);
      const before = w.fingerprint();
      const p = brush(w, { shape });
      p.press(shift(at, 1, 1));
      p.move(shift(at, 8, 8));
      expect(w.fingerprint(), `${shape} mid-drag`).toBe(before);
      p.move(shift(at, 4, 1));
      p.release(shift(at, 4, 1));
      const laid = heldCells(w, rect(at, 10, 10));
      expect(laid.has(`${at.x + 4},${at.y + 1}`), `${shape} reaches the release`).toBe(true);
      expect(laid.has(`${at.x + 8},${at.y + 8}`), `${shape} forgets the abandoned aim`).toBe(false);
    }
  });

  spec('EDIT-01', 'the constrain key squares a rectangle', () => {
    const w = world();
    const at = w.openGround(10, 10);
    const p = brush(w, { shape: 'rect' });
    p.held.constrain = true;
    p.drag(at, shift(at, 6, 2));
    const laid = [...heldCells(w, rect(shift(at, -1, -1), 12, 12))].map((k) => k.split(',').map(Number) as [number, number]);
    const xs = new Set(laid.map(([x]) => x)), ys = new Set(laid.map(([, y]) => y));
    expect(xs.size).toBeGreaterThan(1);
    expect(xs.size).toBe(ys.size);
    expect(laid.length).toBe(xs.size * ys.size);
  });

  spec('EDIT-02', 'a rectangle running onto the coast lays its grass part and skips the rest', () => {
    const w = world();
    const start = coastRow(w, 10);
    const p = brush(w, { shape: 'rect' });
    p.drag(start, shift(start, 9, 2));
    const area = rect(start, 10, 3);
    const laid = heldCells(w, area);
    const onGrass = area.filter((c) => w.state.cells[c.y]![c.x]!.zone === w.state.cells[start.y]![start.x + 9]!.zone);
    expect(laid.size).toBeGreaterThan(0);
    expect(laid.size).toBeLessThan(area.length);
    for (const key of laid) expect(onGrass.map((c) => `${c.x},${c.y}`)).toContain(key);
  });

  spec('EDIT-02', 'a line across a landmark lays the cells either side of it', () => {
    const w = world();
    const plaza = [...w.state.objects.values()].find((o) => o.locked && w.terrainAt(o.position)?.type === TerrainType.Mountain)!;
    const y = plaza.position.y + 5;
    const from = { x: plaza.position.x - 6, y };
    const plazaCell = { x: plaza.position.x + 3, y };
    const before = w.terrainAt(plazaCell);
    brush(w, { shape: 'line' }).drag(from, shift(from, 12, 0));
    expect(w.terrainAt(from)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(w.terrainAt(shift(from, 4, 0))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(w.terrainAt(plazaCell), 'the landmark keeps its ground').toEqual(before);
  });

  spec('EDIT-03', 'a freehand mountain dab is one mark: with any cell refused, none of it is laid', () => {
    const w = world();
    const at = coastRow(w, 3);
    const before = w.fingerprint();
    brush(w, { brushSize: 3 }).click(shift(at, 1, 0));
    expect(w.fingerprint()).toBe(before);
    brush(w).click(shift(at, 2, 0));
    expect(w.terrainAt(shift(at, 2, 0)), 'its grass cell takes a dab of its own').toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });

  spec('EDIT-03', 'a freehand water dab lays the cells that can hold water and skips the rest', () => {
    const w = world();
    const at = coastRow(w, 3);
    brush(w, { brushSize: 3, contentType: 'water' }).click(shift(at, 1, 0));
    const dab = rect(shift(at, 0, -1), 3, 3);
    const laid = heldCells(w, dab);
    expect(laid.size).toBeGreaterThan(0);
    expect(laid.size).toBeLessThan(dab.length);
    expect(w.terrainAt(shift(at, 2, 0))).toEqual({ type: TerrainType.Water, elevation: 0 });
  });

  spec('EDIT-04', 'a fast freehand drag paints an edge-connected band from press to release', () => {
    const w = world();
    const at = w.openGround(10, 10);
    const end = shift(at, 7, 4);
    brush(w).drag(at, end);
    const laid = heldCells(w, rect(at, 10, 10));
    expect(laid.has(`${at.x},${at.y}`) && laid.has(`${end.x},${end.y}`)).toBe(true);
    expect(laid.size).toBeGreaterThanOrEqual(7 + 4 + 1);
    expect(edgeConnected(laid)).toBe(true);
  });

  spec('EDIT-10', 'mountain painted over water takes the water\'s level, and the next stroke stacks', () => {
    const w = world();
    const at = w.openGround(5, 5);
    plateau(w, at, 5, 5, 2);
    const pool = shift(at, 2, 2);
    brush(w, { contentType: 'water' }).click(pool);
    expect(w.terrainAt(pool)).toEqual({ type: TerrainType.Water, elevation: 2 });
    const p = brush(w);
    p.click(pool);
    expect(w.terrainAt(pool)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    p.click(pool);
    expect(w.terrainAt(pool)).toEqual({ type: TerrainType.Mountain, elevation: 3 });
  });
});
