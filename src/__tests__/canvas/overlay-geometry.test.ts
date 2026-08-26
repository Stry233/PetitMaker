/**
 * THE OVERLAY SHADE INVENTORY (2D).
 *
 * Every shade the 2D overlay paints over the map, with the geometric contract it owes: WHAT it must
 * cover and at WHICH alignment. Two alignments exist and the choice is never free — terrain renders
 * on the micro grid (−HALF_TILE, the intersection-centred blocks), everything object-shaped on the
 * macro grid — so a shade drawn at the wrong one lands half a cell off the thing it is about.
 *
 *   shade              covers                                    alignment
 *   ─────────────────  ────────────────────────────────────────  ─────────────────────────────────
 *   hover box          the click target's rect (object footprint macro for an object,
 *                      or one terrain cell)                      micro for a terrain cell
 *   selection ring     the selected body's rect, per member      as above (caller passes)
 *   rubber band        the raw macro band rect                   macro (a band selects objects)
 *   buildable wash     one rect per painted region cell          the caller's grid (terrain)
 *   route drape        one rect per corridor cell                micro ALWAYS (walls stand there)
 *   error flash        each error's evidence: cells, or the      the error's own grid, per error
 *                      exact BODY where an object is the cause
 *   commit flash       the cells a commit changed                the caller's grid
 *   host/agent flash   an agent write's cells, terrain and       per cell, from what stands there;
 *                      freshly placed bodies alike               bare cells fall back to TERRAIN
 *   ghost              the cells the stroke will lay             micro for terrain, macro for tiles
 *
 * The hard cases are the ones where those two grids and a fractional anchor meet: a plain cell, a
 * macro object, the PLAZA (a 20×27 body anchored at x.5/y.5) and a halfStep bridge/ramp anchor.
 * A body on the half grid is why a shade is drawn from a RECT and not from the cells it touches:
 * its whole-cell footprint is a cell wider and a cell taller than the body itself.
 */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import { OverlayLayer } from '../../canvas/map2d/layers/overlay-layer';
import { TILE_SIZE } from '../../core/model/constants';
import { HALF_TILE, bodyEvidence } from '../../core/model/grid-model';
import type { Rect, ValidationError } from '../../core/model/types';

interface DrawnRect { x: number; y: number; w: number; h: number }

/** The rects a Graphics has been told to draw, in world px. */
function drawn(overlay: OverlayLayer, field: string): DrawnRect[] {
  const g = (overlay as unknown as Record<string, { geometry: { graphicsData: { shape: { x: number; y: number; width: number; height: number } }[] } }>)[field]!;
  return g.geometry.graphicsData
    .filter((d) => typeof d.shape?.width === 'number')
    .map((d) => ({ x: d.shape.x, y: d.shape.y, w: d.shape.width, h: d.shape.height }));
}

/** One drawn rect in MACRO units at the given alignment — what the user sees it cover. */
function macro(r: DrawnRect, micro: boolean): Rect {
  const off = micro ? HALF_TILE : 0;
  return { x: (r.x + off) / TILE_SIZE, y: (r.y + off) / TILE_SIZE, w: r.w / TILE_SIZE, h: r.h / TILE_SIZE };
}

/** The ONE rect a shade drew, in macro units. Asserting the count matters as much as the box: a
 *  union that looks right can still hide a second rect inside the body. */
function soleRect(rects: DrawnRect[], micro: boolean): Rect {
  expect(rects).toHaveLength(1);
  return macro(rects[0]!, micro);
}

/** One rAF turn — the ghost build and the flash fade both run there. */
const frame = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); });

const err = (cells: { x: number; y: number }[], grid?: 'macro' | 'micro'): ValidationError =>
  ({ ruleId: 'T', message: 'test', cells, severity: 'error', ...(grid ? { grid } : {}) });
const bodyErr = (rects: Rect[], grid?: 'macro' | 'micro'): ValidationError =>
  ({ ruleId: 'T', message: 'test', ...bodyEvidence(rects), severity: 'error', ...(grid ? { grid } : {}) });

/** The cases every rect-shaped shade is asked about. `micro` is the alignment the caller passes. */
const BODIES: Array<{ name: string; x: number; y: number; w: number; h: number; micro: boolean }> = [
  { name: 'plain terrain cell', x: 4, y: 5, w: 1, h: 1, micro: true },
  { name: 'terrain cell at the map corner', x: 0, y: 0, w: 1, h: 1, micro: true },
  { name: 'macro object 2x3', x: 4, y: 5, w: 2, h: 3, micro: false },
  { name: 'the plaza (fractional anchor)', x: 76.5, y: 58.5, w: 20, h: 27, micro: false },
  { name: 'halfStep bridge anchor', x: 10.5, y: 12.5, w: 4, h: 1, micro: false },
  { name: 'halfStep ramp anchor, rotated', x: 3, y: 7.5, w: 1, h: 4, micro: false },
];

describe('overlay shades: a rect-shaped shade covers its body exactly', () => {
  for (const c of BODIES) {
    it(`hover box — ${c.name}`, () => {
      const overlay = new OverlayLayer();
      overlay.showHover(c.x, c.y, c.w, c.h, c.micro);
      expect(soleRect(drawn(overlay, 'hoverGraphics'), c.micro)).toEqual({ x: c.x, y: c.y, w: c.w, h: c.h });
    });

    it(`selection ring — ${c.name}`, () => {
      const overlay = new OverlayLayer();
      overlay.showSelection(c.x, c.y, c.w, c.h, undefined, c.micro);
      expect(soleRect(drawn(overlay, 'selectionGraphics'), c.micro)).toEqual({ x: c.x, y: c.y, w: c.w, h: c.h });
    });
  }

  it('a group selection appends one ring per member, each on its own body', () => {
    const overlay = new OverlayLayer();
    overlay.clearSelection();
    overlay.showSelection(4, 5, 2, 2, undefined, false, true);
    overlay.showSelection(76.5, 58.5, 20, 27, undefined, false, true);
    const rects = drawn(overlay, 'selectionGraphics');
    expect(rects).toHaveLength(2);
    expect(macro(rects[0]!, false)).toEqual({ x: 4, y: 5, w: 2, h: 2 });
    expect(macro(rects[1]!, false)).toEqual({ x: 76.5, y: 58.5, w: 20, h: 27 });
  });

  it('the rubber band draws the raw macro rect (a band only ever selects objects)', () => {
    const overlay = new OverlayLayer();
    overlay.showBand({ x: 2.5, y: 3, w: 4, h: 1.5 });
    // fill + four dashed edges; the FILL is the shade.
    expect(soleRect(drawn(overlay, 'bandGraphics'), false)).toEqual({ x: 2.5, y: 3, w: 4, h: 1.5 });
  });
});

describe('overlay shades: cell-set shades draw one unit cell each, on the asked-for grid', () => {
  it('the buildable-region wash follows its caller\'s grid', () => {
    const overlay = new OverlayLayer();
    overlay.showBuildableRegion([{ x: 3, y: 4 }, { x: 4, y: 4 }], true);
    const rects = drawn(overlay, 'buildableGraphics');
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 3 * TILE_SIZE - HALF_TILE, y: 4 * TILE_SIZE - HALF_TILE, w: TILE_SIZE, h: TILE_SIZE });
    const macroGrid = new OverlayLayer();
    macroGrid.showBuildableRegion([{ x: 3, y: 4 }], false);
    expect(drawn(macroGrid, 'buildableGraphics')[0]).toEqual({ x: 3 * TILE_SIZE, y: 4 * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE });
  });

  it('the route drape is on the TERRAIN grid whatever the caller thinks — the walls stand there', () => {
    const overlay = new OverlayLayer();
    overlay.showRoute([{ x: 6, y: 7 }]);
    expect(drawn(overlay, 'routeGraphics')[0])
      .toEqual({ x: 6 * TILE_SIZE - HALF_TILE, y: 7 * TILE_SIZE - HALF_TILE, w: TILE_SIZE, h: TILE_SIZE });
  });
});

describe('overlay shades: the error flash', () => {
  it('flashes evidence cells on the error\'s own grid, merged per row', async () => {
    const overlay = new OverlayLayer();
    overlay.flashErrors([err([{ x: 3, y: 4 }, { x: 4, y: 4 }], 'micro')], false);
    await frame();
    const rects = drawn(overlay, 'errorGraphics');
    expect(rects).toHaveLength(1); // one merged span
    expect(rects[0]).toEqual({ x: 3 * TILE_SIZE - HALF_TILE, y: 4 * TILE_SIZE - HALF_TILE, w: 2 * TILE_SIZE, h: TILE_SIZE });
  });

  it('flashes a BODY as the body: the plaza\'s shade is the plaza, not a cell wider (issue #14)', async () => {
    const overlay = new OverlayLayer();
    const plaza: Rect = { x: 76.5, y: 58.5, w: 20, h: 27 };
    overlay.flashErrors([bodyErr([plaza], 'macro')], true);
    await frame();
    const rects = drawn(overlay, 'errorGraphics');
    expect(rects).toHaveLength(1);
    expect(soleRect(rects, false)).toEqual(plaza);
  });

  it('a body and plain cells in one refusal each keep their own shape and grid', async () => {
    const overlay = new OverlayLayer();
    overlay.flashErrors([
      bodyErr([{ x: 10.5, y: 12.5, w: 4, h: 1 }], 'macro'),
      err([{ x: 2, y: 2 }], 'micro'),
    ], true);
    await frame();
    const rects = drawn(overlay, 'errorGraphics');
    expect(rects).toHaveLength(2);
    const cell = rects.find((r) => r.w === TILE_SIZE)!;
    expect(cell).toEqual({ x: 2 * TILE_SIZE - HALF_TILE, y: 2 * TILE_SIZE - HALF_TILE, w: TILE_SIZE, h: TILE_SIZE });
    expect(macro(rects.find((r) => r.w === 4 * TILE_SIZE)!, false)).toEqual({ x: 10.5, y: 12.5, w: 4, h: 1 });
  });
});

describe('overlay shades: the commit flash and the agent write acknowledgement', () => {
  it('a bare cell list falls back to the TERRAIN grid — the same default the 3D view states', async () => {
    // The one caller that passes no terrainMode is `host.feedback.flash`, and the two views must
    // not answer it differently. A plain MacroCoord list names grid cells, which terrain is on.
    const overlay = new OverlayLayer();
    overlay.flashCommit([{ x: 3, y: 4 }]);
    await frame();
    expect(soleRect(drawn(overlay, 'commitGraphics'), true)).toEqual({ x: 3, y: 4, w: 1, h: 1 });
  });

  it('honours a per-cell grid: one write of terrain and a body draws each where it stands', async () => {
    // What `resolveCellsFlash` hands the host for an agent write that painted (1,1) and placed a
    // 2x1 body at (5,6) — the two land half a cell apart, which is the point.
    const overlay = new OverlayLayer();
    overlay.flashCommit([
      { x: 1, y: 1, micro: true },
      { x: 5, y: 6, micro: false }, { x: 6, y: 6, micro: false },
    ]);
    await frame();
    const rects = drawn(overlay, 'commitGraphics');
    expect(rects).toHaveLength(2); // the terrain cell, and the body merged into one span
    expect(macro(rects.find((r) => r.w === TILE_SIZE)!, true)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
    expect(macro(rects.find((r) => r.w === 2 * TILE_SIZE)!, false)).toEqual({ x: 5, y: 6, w: 2, h: 1 });
  });

  it('an explicit terrainMode still governs a list that carries no per-cell grid', async () => {
    const overlay = new OverlayLayer();
    overlay.flashCommit([{ x: 3, y: 4 }], { terrainMode: false });
    await frame();
    expect(soleRect(drawn(overlay, 'commitGraphics'), false)).toEqual({ x: 3, y: 4, w: 1, h: 1 });
  });
});

describe('overlay shades: the ghost', () => {
  it('lays the cells it is given on the grid it is given, merged per row', async () => {
    const overlay = new OverlayLayer();
    overlay.showGhost([{ x: 3, y: 4 }, { x: 4, y: 4 }], 0x22c55e, true);
    await frame();
    const fill = drawn(overlay, 'ghostGraphics')[0]!;
    expect(fill).toEqual({ x: 3 * TILE_SIZE - HALF_TILE, y: 4 * TILE_SIZE - HALF_TILE, w: 2 * TILE_SIZE, h: TILE_SIZE });
  });

  it('a halfStep item\'s footprint ghosts at its own half-cell anchor, not the whole cell', async () => {
    const overlay = new OverlayLayer();
    // What `planPlacementGhost` hands over for a 4x1 bridge anchored at (10.5, 12.5).
    overlay.showGhost([
      { x: 10.5, y: 12.5 }, { x: 11.5, y: 12.5 }, { x: 12.5, y: 12.5 }, { x: 13.5, y: 12.5 },
    ], 0x22c55e, false);
    await frame();
    const fill = drawn(overlay, 'ghostGraphics')[0]!;
    expect(fill).toEqual({ x: 10.5 * TILE_SIZE, y: 12.5 * TILE_SIZE, w: 4 * TILE_SIZE, h: TILE_SIZE });
  });
});
