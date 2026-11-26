/** Curves: anchors laid click by click, finished by a double-click, then adjusted in place. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world } from '../_world';
import { brush, heldCells, picture, plateau } from './_editing';
import type { MacroCoord } from '../../../core/model/types';

const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });
const anchorsOf = (p: ReturnType<typeof brush>) => p.curve.get()?.anchors.map(({ x, y }) => ({ x, y }));

/** A two-anchor mountain curve along a row of open ground, finished; the pointer keeps its handles. */
function drawn() {
  const w = world();
  const at = w.openGround(14, 10);
  const a = shift(at, 1, 2), b = shift(at, 9, 2);
  const p = brush(w, { shape: 'curve' });
  p.click(a);
  p.doubleClick(b);
  return { w, at, a, b, p, area: rect(at, 14, 10) };
}

describe('drawing a curve', () => {
  spec('EDIT-36', 'a curve paints nothing until a double-click finishes it', () => {
    const w = world();
    const at = w.openGround(12, 8);
    const before = picture(w);
    const p = brush(w, { shape: 'curve' });
    p.click(shift(at, 1, 1));
    p.click(shift(at, 5, 6));
    p.click(shift(at, 10, 2));
    expect(picture(w)).toBe(before);
    p.doubleClick(shift(at, 10, 2));
    for (const c of [shift(at, 1, 1), shift(at, 5, 6), shift(at, 10, 2)]) {
      expect(w.terrainAt(c), `anchor ${c.x},${c.y}`).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    }
  });

  spec('EDIT-36', 'Delete takes back the last anchor', () => {
    const w = world();
    const at = w.openGround(12, 8);
    const p = brush(w, { shape: 'curve' });
    p.click(shift(at, 1, 1));
    p.click(shift(at, 5, 1));
    p.click(shift(at, 10, 6));
    expect(p.deleteStep()).toBe(true);
    p.doubleClick(shift(at, 5, 1));
    expect(w.terrainAt(shift(at, 5, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(w.terrainAt(shift(at, 10, 6)), 'the anchor taken back').toBeNull();
    expect(heldCells(w, rect(shift(at, 6, 2), 6, 6)).size, 'nothing toward it either').toBe(0);
  });

  spec('EDIT-36', 'Escape abandons an unfinished curve without painting anything', () => {
    const w = world();
    const at = w.openGround(12, 8);
    const before = picture(w);
    const p = brush(w, { shape: 'curve' });
    p.click(shift(at, 1, 1));
    p.click(shift(at, 8, 5));
    expect(p.escape()).toBe(true);
    expect(picture(w)).toBe(before);
    p.click(shift(at, 1, 6));
    p.doubleClick(shift(at, 4, 6));
    expect(w.terrainAt(shift(at, 8, 5)), 'the abandoned chain is gone').toBeNull();
    expect(w.terrainAt(shift(at, 4, 6))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });
});

describe('adjusting a curve', () => {
  spec('EDIT-37', 'dragging an anchor lays the curve again: the old path is restored and overlaps never stack twice', () => {
    const { w, a, b, p } = drawn();
    expect(p.curve.isOpen()).toBe(true);
    const end = shift(b, -2, 5);
    p.curve.moveAnchor(1, end.x, end.y, true);
    expect(w.terrainAt(b), 'the old end goes back to bare ground').toBeNull();
    expect(w.terrainAt(end)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(w.terrainAt(a), 'shared by both paths, laid once').toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });

  spec('EDIT-37', 'the old path returns to what it held before the curve', () => {
    const w = world();
    const at = w.openGround(14, 10);
    const a = shift(at, 1, 2), b = shift(at, 9, 2);
    plateau(w, shift(at, 0, 1), 11, 3, 1);
    plateau(w, shift(at, 0, 7), 11, 3, 1);
    const p = brush(w, { shape: 'curve' });
    p.click(a);
    p.doubleClick(b);
    expect(w.terrainAt(shift(at, 5, 2)), 'the curve built on the strip').toEqual({ type: TerrainType.Mountain, elevation: 2 });
    p.curve.moveAnchor(1, b.x, b.y + 6, true);
    p.curve.moveAnchor(0, a.x, a.y + 6, true);
    expect(w.terrainAt(shift(at, 5, 2)), 'the strip as it was').toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(w.terrainAt(shift(at, 5, 8)), 'the curve on the other strip, on its own layer').toEqual({ type: TerrainType.Mountain, elevation: 2 });
  });

  spec('EDIT-37', 'a direction handle bends the curve, and each adjustment is its own undo step', () => {
    const { w, b, p } = drawn();
    const first = picture(w);
    p.curve.setHandle(0, 'out', 4, 6, { commit: true, mirror: true });
    const bent = picture(w);
    expect(bent).not.toBe(first);
    expect(anchorsOf(p)?.[1], 'the anchors stay put').toEqual(b);
    p.curve.moveAnchor(1, b.x, b.y + 3, true);
    w.undo();
    expect(picture(w)).toBe(bent);
    w.undo();
    expect(picture(w)).toBe(first);
  });

  spec('EDIT-37', 'Escape or a click elsewhere puts the handles away and keeps the curve', () => {
    for (const away of ['escape', 'click'] as const) {
      const { w, at, p } = drawn();
      const laid = picture(w);
      if (away === 'escape') expect(p.escape()).toBe(true);
      else p.click(shift(at, 12, 8));
      expect(p.curve.isOpen(), away).toBe(false);
      expect(picture(w), away).toBe(laid);
    }
  });

  spec('EDIT-38', 'an adjustment the rules refuse puts the map and the handles back and leaves no undo step', () => {
    const w = world();
    const at = w.openGround(14, 12);
    const before = picture(w);
    plateau(w, at, 12, 6, 3);
    const withPlateau = picture(w);
    // Layer 4 inside the plateau has its support; on the plateau's rim it has none.
    const p = brush(w, { shape: 'curve' });
    p.click(shift(at, 2, 2));
    p.doubleClick(shift(at, 9, 2));
    const curve = picture(w);
    const anchors = anchorsOf(p);

    p.curve.moveAnchor(1, at.x + 9, at.y + 8, true);
    expect(picture(w), 'the map as the curve left it').toBe(curve);
    expect(anchorsOf(p), 'the handles where they were').toEqual(anchors);
    expect(p.toasts.length).toBeGreaterThan(0);

    w.undo();
    expect(picture(w), 'one undo takes the curve itself').toBe(withPlateau);
    for (let layer = 0; layer < 3; layer++) w.undo();
    expect(picture(w)).toBe(before);
  });
});
