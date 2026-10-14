// @vitest-environment jsdom
/**
 * The 2D overlay shade inventory. Terrain renders on the terrain grid and objects on the placement
 * grid, so a shade on the wrong one lands half a cell off; every call names its grid:
 *   hover box, selection marks   placement for an object, terrain for a cell (caller passes)
 *   rubber band                  placement
 *   buildable wash, route drape  the caller's grid (terrain)
 *   error flash, commit flash    each error's or set's own grid; an object cause flashes its body
 *   ghost                        terrain, or placement for tiles
 * a shade is drawn from a rect, not the cells it touches: a half-grid body (the plaza at x.5/y.5, a
 * halfStep anchor) has a whole-cell footprint a cell wider and taller than itself.
 */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { TILE_SIZE, TERRAIN_GRID_OFFSET_PX, gridOffsetPx } from '../../../../view/map2d/geometry/world';
import { bodyEvidence } from '../../../../core/grid/footprint';
import type { ValidationError } from '../../../../core/model/types';
import type { Rect } from '../../../../core/grid/rect';
import type { GridId } from '../../../../core/grid/grids';
import { PLAZA_RECT } from '../../../_support/planet';
import { mixedCellSet, cellSet, evidenceOn } from '../../../../core/grid/grids';
import { overlayPart } from '../../../_support/overlay-parts';

interface DrawnRect { x: number; y: number; w: number; h: number }

/** The rects a Graphics has been told to draw, in world px. */
function drawn(overlay: OverlayLayer, field: string): DrawnRect[] {
  const g = overlayPart<{ geometry: { graphicsData: { shape: { x: number; y: number; width: number; height: number } }[] } }>(overlay, field);
  return g.geometry.graphicsData
    .filter((d) => typeof d.shape?.width === 'number')
    .map((d) => ({ x: d.shape.x, y: d.shape.y, w: d.shape.width, h: d.shape.height }));
}

/** The box a Graphics' line work spans (bracket arms, rings), in world px. */
function lineBounds(overlay: OverlayLayer, field: string): DrawnRect {
  const g = overlayPart<{ geometry: { graphicsData: { shape: { points?: number[]; x?: number; y?: number; radius?: number } }[] } }>(overlay, field);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const { shape } of g.geometry.graphicsData) {
    if (shape.points) for (let i = 0; i < shape.points.length; i += 2) {
      x0 = Math.min(x0, shape.points[i]!); x1 = Math.max(x1, shape.points[i]!);
      y0 = Math.min(y0, shape.points[i + 1]!); y1 = Math.max(y1, shape.points[i + 1]!);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Ring centres a Graphics drew, in world px. */
function ringCentres(overlay: OverlayLayer, field: string): { x: number; y: number }[] {
  const g = overlayPart<{ geometry: { graphicsData: { shape: { x?: number; y?: number; radius?: number } }[] } }>(overlay, field);
  return g.geometry.graphicsData.filter((d) => typeof d.shape.radius === 'number').map((d) => ({ x: d.shape.x!, y: d.shape.y! }));
}

/** Selection brackets stand this far outside a single body, and group brackets outside the union,
 *  in screen px (world px at zoom 1). */
const MARK_PAD = 4, GROUP_PAD = 10;
const grow = (r: DrawnRect, pad: number): DrawnRect => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad });
const world = (c: { x: number; y: number; w: number; h: number; grid?: GridId }): DrawnRect => {
  const off = gridOffsetPx(c.grid ?? 'object');
  return { x: c.x * TILE_SIZE + off.x, y: c.y * TILE_SIZE + off.y, w: c.w * TILE_SIZE, h: c.h * TILE_SIZE };
};
const close = (a: DrawnRect, b: DrawnRect) => {
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(a[k]).toBeCloseTo(b[k], 5);
};

/** One drawn rect in cells at the given grid — what the user sees it cover. */
function macro(r: DrawnRect, grid: GridId): Rect {
  const off = gridOffsetPx(grid);
  return { x: (r.x - off.x) / TILE_SIZE, y: (r.y - off.y) / TILE_SIZE, w: r.w / TILE_SIZE, h: r.h / TILE_SIZE };
}

/** The one rect a shade drew, in macro units. Asserting the count matters as much as the box: a
 *  union that looks right can still hide a second rect inside the body. */
function soleRect(rects: DrawnRect[], grid: GridId): Rect {
  expect(rects).toHaveLength(1);
  return macro(rects[0]!, grid);
}

/** One rAF turn — the ghost build and the flash fade both run there. */
const frame = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); });

const err = (cells: { x: number; y: number }[], grid: GridId): ValidationError =>
  ({ ruleId: 'T', message: 'test', ...evidenceOn(grid, cells) });
const bodyErr = (rects: Rect[], grid: GridId): ValidationError =>
  ({ ruleId: 'T', message: 'test', ...evidenceOn(grid, bodyEvidence(rects).cells), rects: bodyEvidence(rects).rects });

/** The cases every rect-shaped shade is asked about. `grid` is the alignment the caller passes. */
const BODIES: Array<{ name: string; x: number; y: number; w: number; h: number; grid: GridId }> = [
  { name: 'plain terrain cell', x: 4, y: 5, w: 1, h: 1, grid: 'terrain' },
  { name: 'terrain cell at the map corner', x: 0, y: 0, w: 1, h: 1, grid: 'terrain' },
  { name: 'placement object 2x3', x: 4, y: 5, w: 2, h: 3, grid: 'object' },
  { name: 'the plaza (fractional anchor)', ...PLAZA_RECT, grid: 'object' },
  { name: 'halfStep bridge anchor', x: 10.5, y: 12.5, w: 4, h: 1, grid: 'object' },
  { name: 'halfStep ramp anchor, rotated', x: 3, y: 7.5, w: 1, h: 4, grid: 'object' },
];

describe('overlay shades: a rect-shaped shade covers its body exactly', () => {
  for (const c of BODIES) {
    it(`hover box — ${c.name}`, () => {
      const overlay = new OverlayLayer(() => {});
      overlay.showHover(c, c.grid);
      expect(soleRect(drawn(overlay, 'hoverGraphics'), c.grid)).toEqual({ x: c.x, y: c.y, w: c.w, h: c.h });
    });

    it(`selection marks — ${c.name}`, () => {
      const overlay = new OverlayLayer(() => {});
      // A terrain cell is regular, so the selection painter marks it exact.
      const exact = c.grid === 'terrain';
      overlay.showSelection(c, c.grid, { exact });
      if (exact) {
        // Its exact outline, edge and ink both on the cell.
        const rects = drawn(overlay, 'selectionGraphics');
        expect(rects).toHaveLength(2);
        for (const r of rects) expect(macro(r, 'terrain')).toEqual({ x: c.x, y: c.y, w: c.w, h: c.h });
      } else close(lineBounds(overlay, 'selectionGraphics'), grow(world(c), MARK_PAD));
    });
  }

  it('a lone road gets its exact outline, as a terrain cell does', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showSelection({ x: 6, y: 7, w: 1, h: 1 }, 'object', { exact: true });
    const rects = drawn(overlay, 'selectionGraphics');
    expect(rects).toHaveLength(2);
    for (const r of rects) expect(macro(r, 'object')).toEqual({ x: 6, y: 7, w: 1, h: 1 });
  });

  it('a group selection rings each member on its own body and brackets the whole', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.clearSelection();
    overlay.showSelection({ x: 4, y: 5, w: 2, h: 2 }, 'object', { append: true });
    overlay.showSelection(PLAZA_RECT, 'object', { append: true });
    overlay.showSelection({ x: 10.5, y: 12.5, w: 4, h: 1 }, 'object', { append: true });
    const a = world({ x: 4, y: 5, w: 2, h: 2 }), b = world({ ...PLAZA_RECT }), c = world({ x: 10.5, y: 12.5, w: 4, h: 1 });
    const centres = ringCentres(overlay, 'selectionGraphics');
    const unique = centres.filter((p, i) => centres.findIndex((q) => q.x === p.x && q.y === p.y) === i);
    expect(unique).toEqual([a, b, c].map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })));
    const union = { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y };
    close(lineBounds(overlay, 'selectionFrame'), grow(union, GROUP_PAD));
  });

  it('the rubber band draws the raw placement rect (a band only ever selects objects)', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showBand({ x: 2.5, y: 3, w: 4, h: 1.5 });
    // fill + four dashed edges; the fill is the shade.
    expect(soleRect(drawn(overlay, 'bandGraphics'), 'object')).toEqual({ x: 2.5, y: 3, w: 4, h: 1.5 });
  });
});

describe('overlay shades: cell-set shades draw one unit cell each, on the asked-for grid', () => {
  it('the buildable-region wash follows its caller\'s grid', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showBuildableRegion(cellSet('terrain', [{ x: 3, y: 4 }, { x: 4, y: 4 }]));
    const rects = drawn(overlay, 'buildableGraphics');
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 3 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x, y: 4 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.y, w: TILE_SIZE, h: TILE_SIZE });
    const macroGrid = new OverlayLayer(() => {});
    macroGrid.showBuildableRegion(cellSet('object', [{ x: 3, y: 4 }]));
    expect(drawn(macroGrid, 'buildableGraphics')[0]).toEqual({ x: 3 * TILE_SIZE, y: 4 * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE });
  });

  it('the route drape draws its corridor cells on the terrain grid the maze walls stand on', () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showPath(cellSet('terrain', [{ x: 6, y: 7 }]));
    expect(drawn(overlay, 'routeGraphics')[0])
      .toEqual({ x: 6 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x, y: 7 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.y, w: TILE_SIZE, h: TILE_SIZE });
  });
});

describe('overlay shades: the error flash', () => {
  it('flashes evidence cells on the error\'s own grid, merged per row', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.flashErrors([err([{ x: 3, y: 4 }, { x: 4, y: 4 }], 'terrain')]);
    await frame();
    const rects = drawn(overlay, 'errorGraphics');
    expect(rects).toHaveLength(1); // one merged span
    expect(rects[0]).toEqual({ x: 3 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x, y: 4 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.y, w: 2 * TILE_SIZE, h: TILE_SIZE });
  });

  it('flashes the plaza body without expanding to whole-cell bounds', async () => {
    const overlay = new OverlayLayer(() => {});
    const plaza: Rect = { ...PLAZA_RECT };
    overlay.flashErrors([bodyErr([plaza], 'object')]);
    await frame();
    const rects = drawn(overlay, 'errorGraphics');
    expect(rects).toHaveLength(1);
    expect(soleRect(rects, 'object')).toEqual(plaza);
  });

  it('a body and plain cells in one refusal each keep their own shape and grid', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.flashErrors([
      bodyErr([{ x: 10.5, y: 12.5, w: 4, h: 1 }], 'object'),
      err([{ x: 2, y: 2 }], 'terrain'),
    ]);
    await frame();
    const rects = drawn(overlay, 'errorGraphics');
    expect(rects).toHaveLength(2);
    const cell = rects.find((r) => r.w === TILE_SIZE)!;
    expect(cell).toEqual({ x: 2 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x, y: 2 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.y, w: TILE_SIZE, h: TILE_SIZE });
    expect(macro(rects.find((r) => r.w === 4 * TILE_SIZE)!, 'object')).toEqual({ x: 10.5, y: 12.5, w: 4, h: 1 });
  });
});

describe('overlay shades: the commit flash', () => {
  it('draws each set on its own grid: a terrain cell and a body land half a cell apart', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.flashCommit([
      cellSet('terrain', [{ x: 1, y: 1 }]),
      cellSet('object', [{ x: 5, y: 6 }, { x: 6, y: 6 }]),
    ]);
    await frame();
    const rects = drawn(overlay, 'commitGraphics');
    expect(rects).toHaveLength(2); // the terrain cell, and the body merged into one span
    expect(macro(rects.find((r) => r.w === TILE_SIZE)!, 'terrain')).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(macro(rects.find((r) => r.w === 2 * TILE_SIZE)!, 'object')).toEqual({ x: 5, y: 6, w: 2, h: 1 });
  });

  it('draws a placement-grid set unshifted', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.flashCommit([cellSet('object', [{ x: 3, y: 4 }])]);
    await frame();
    expect(soleRect(drawn(overlay, 'commitGraphics'), 'object')).toEqual({ x: 3, y: 4, w: 1, h: 1 });
  });
});

describe('overlay shades: the ghost', () => {
  it('lays the cells it is given on the grid it is given, merged per row', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGhost(mixedCellSet('terrain', [{ x: 3, y: 4 }, { x: 4, y: 4 }]), { wash: 'placement', valid: true });
    await frame();
    const fill = drawn(overlay, 'ghostGraphics')[0]!;
    expect(fill).toEqual({ x: 3 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x, y: 4 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.y, w: 2 * TILE_SIZE, h: TILE_SIZE });
  });

  it('a halfStep item\'s footprint ghosts at its own half-cell anchor, not the whole cell', async () => {
    const overlay = new OverlayLayer(() => {});
    // What `planPlacementGhost` hands over for a 4x1 bridge anchored at (10.5, 12.5).
    overlay.showGhost(mixedCellSet('object', [
      { x: 10.5, y: 12.5 }, { x: 11.5, y: 12.5 }, { x: 12.5, y: 12.5 }, { x: 13.5, y: 12.5 },
    ]), { wash: 'placement', valid: true });
    await frame();
    const fill = drawn(overlay, 'ghostGraphics')[0]!;
    expect(fill).toEqual({ x: 10.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, w: 4 * TILE_SIZE, h: TILE_SIZE });
  });
});
