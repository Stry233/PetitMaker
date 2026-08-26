// @vitest-environment node
/** The bench's shot builder: rect normalization, the terrain crop a region'd view_map renders,
 *  the ruler geometry burned into every shot, and the render-terrain wire shape. */
import { describe, expect, it } from 'vitest';
import { cropTerrain, normalizeRect, rulerFor, shotJson } from '../../../agent/eval/shots';
import type { TerrainArrays } from '../../../agent/eval/dump';

/** 5x4 grid with position-coded values (tier = 10y+x) so a slice error is visible in the numbers. */
function grid(): TerrainArrays {
  const tier: number[] = [], water: number[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 5; x++) {
      tier.push(10 * y + x);
      water.push(-1);
    }
  }
  return {
    tier, water, w: 5, h: 4,
    objects: [
      { kind: 'building', e: 0, x: 1, y: 1, w: 2, h: 1 },  // fully inside the (1,1)-(3,2) crop
      { kind: 'road', e: 0, x: 3, y: 2, w: 2, h: 1 },      // straddles the crop's east edge
      { kind: 'tree', e: 0, x: 0, y: 3, w: 1, h: 1 },      // outside it
    ],
  };
}

describe('normalizeRect', () => {
  it('sorts reversed corners and clamps to the map bounds', () => {
    expect(normalizeRect({ x1: 7, y1: 3, x2: -2, y2: 1 }, 5, 4)).toEqual({ x1: 0, y1: 1, x2: 4, y2: 3 });
  });

  it('returns null for a rect entirely off the map', () => {
    expect(normalizeRect({ x1: 9, y1: 9, x2: 12, y2: 12 }, 5, 4)).toBeNull();
    expect(normalizeRect({ x1: -5, y1: 0, x2: -1, y2: 3 }, 5, 4)).toBeNull();
  });
});

describe('cropTerrain', () => {
  it('slices tier/water to the rect and re-bases intersecting objects, clamping the straddler and dropping the outsider', () => {
    const c = cropTerrain(grid(), { x1: 1, y1: 1, x2: 3, y2: 2 });
    expect(c.w).toBe(3);
    expect(c.h).toBe(2);
    expect(c.tier).toEqual([11, 12, 13, 21, 22, 23]);
    expect(c.water).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(c.objects).toEqual([
      { kind: 'building', e: 0, x: 0, y: 0, w: 2, h: 1 },
      { kind: 'road', e: 0, x: 2, y: 1, w: 1, h: 1 },
    ]);
  });
});

describe('rulerFor', () => {
  it('labels every 10 cells with minor lines every 5, at absolute origin coordinates', () => {
    expect(rulerFor(30, 20, 40, 25)).toMatchObject({ step: 10, minor: 5, x0: 40, y0: 25 });
    expect(rulerFor(30, 20)).toMatchObject({ x0: 0, y0: 0 });
  });

  it('scales cells so a whole hexia map and a small crop both land legible: 4px at 169 wide, capped at 12px for tiny rects', () => {
    expect(rulerFor(169, 140).cellPx).toBe(4);
    expect(rulerFor(30, 20).cellPx).toBe(12);
    expect(rulerFor(100, 100).cellPx).toBe(7);
  });
});

describe('shotJson', () => {
  it('wraps one map in the render-terrain montage shape with the ruler block at the top level', () => {
    const t = grid();
    const ruler = rulerFor(t.w, t.h);
    expect(shotJson(t, 'village', ruler)).toEqual({
      size: 5, cols: 1, w: 5, h: 4, ruler,
      maps: [{ row: 0, col: 0, label: 'village', tier: t.tier, water: t.water, objects: t.objects }],
    });
  });
});
