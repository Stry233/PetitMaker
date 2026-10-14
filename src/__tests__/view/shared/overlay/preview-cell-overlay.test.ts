// @vitest-environment jsdom
/**
 * The preview card, as the 2D overlay draws it.
 *
 * The pure geometry is pinned in `preview-cell.test.ts`; this is the wiring: a ghost handed a
 * PreviewCell paints the card (one background at the footprint, four dots at the footprint's own
 * corners, the glyph at 1x1 size in the middle) on the grid the caller named, and a ghost handed a
 * placement wash paints a square tint with nothing extra.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, vi } from 'vitest';

// jsdom has no Path2D, so the shared rasteriser can draw nothing there. The glyph's size and place
// are what this file is about, so it is handed a blank canvas of the right shape instead.
vi.mock('../../../../view/shared/overlay/preview-cell-raster', () => ({
  HATCH_CELLS: 3,
  previewIconCanvas: () => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    return c;
  },
  previewHatchCanvas: () => null,
}));
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { TILE_SIZE, TERRAIN_GRID_OFFSET_PX } from '../../../../view/map2d/geometry/world';
import {
  PREVIEW_CELL_ART, PREVIEW_ICON_ART, PREVIEW_PALETTES, previewDots,
} from '../../../../view/shared/overlay/preview-cell';
import { mixedCellSet } from '../../../../core/grid/grids';
import { overlayPart } from '../../../_support/overlay-parts';
import { washColor } from '../../../../view/shared/overlay/preview-cell';

interface Shape { x: number; y: number; width?: number; height?: number; radius?: number; type?: number }
interface Data { shape: Shape; fillStyle?: { color: number; alpha: number }; lineStyle?: { color: number; width: number; alpha: number } }

function graphicsData(overlay: OverlayLayer, field: string): Data[] {
  const g = overlayPart<{ geometry: { graphicsData: Data[] } }>(overlay, field);
  return g.geometry.graphicsData;
}

const icon = (overlay: OverlayLayer) =>
  overlayPart<{ visible: boolean; x: number; y: number; width: number; height: number }>(overlay, 'previewIcon');

const frame = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); });

const cells = (x: number, y: number, n: number) =>
  Array.from({ length: n * n }, (_, i) => ({ x: x + (i % n), y: y + Math.floor(i / n) }));

describe('the preview card in the 2D overlay', () => {
  it('draws ONE background over the whole footprint, on the terrain grid', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGhost(mixedCellSet('terrain', cells(4, 6, 3)), { icon: 'mountain', valid: true });
    await frame();
    const rects = graphicsData(overlay, 'ghostGraphics').filter((d) => typeof d.shape.width === 'number');
    // one fill + one stroke pass over the same rect
    expect(rects.length).toBe(2);
    for (const r of rects) {
      expect(r.shape.x).toBeCloseTo(4 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.x, 6);
      expect(r.shape.y).toBeCloseTo(6 * TILE_SIZE + TERRAIN_GRID_OFFSET_PX.y, 6);
      expect(r.shape.width).toBeCloseTo(3 * TILE_SIZE, 6);
      expect(r.shape.height).toBeCloseTo(3 * TILE_SIZE, 6);
      expect(r.shape.radius).toBeCloseTo(PREVIEW_CELL_ART.radius * TILE_SIZE, 6);
    }
  });

  it('puts the four dots at the footprint corners, in the palette colour, whatever the size', async () => {
    for (const n of [1, 5]) {
      const overlay = new OverlayLayer(() => {});
      overlay.showGhost(mixedCellSet('object', cells(10, 20, n)), { icon: 'ground', valid: true });
      await frame();
      const circles = graphicsData(overlay, 'ghostGraphics').filter((d) => d.shape.radius !== undefined && d.shape.width === undefined);
      expect(circles).toHaveLength(4);
      const want = previewDots({ x: 10, y: 20, w: n, h: n });
      for (const dot of want) {
        const hit = circles.find((c) => Math.abs(c.shape.x - dot.x * TILE_SIZE) < 1e-6 && Math.abs(c.shape.y - dot.y * TILE_SIZE) < 1e-6);
        expect(hit, `dot at ${dot.x},${dot.y} for ${n}x${n}`).toBeDefined();
        expect(hit!.shape.radius).toBeCloseTo(PREVIEW_CELL_ART.dotRadius * TILE_SIZE, 6);
        expect(hit!.fillStyle?.color).toBe(PREVIEW_PALETTES.valid.line);
      }
    }
  });

  it('keeps the glyph at 1x1 size in the middle of a big footprint', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGhost(mixedCellSet('object', cells(2, 3, 6)), { icon: 'water', valid: true });
    await frame();
    const art = PREVIEW_ICON_ART.water;
    const g = icon(overlay);
    expect(g.visible).toBe(true);
    expect(g.x).toBeCloseTo((2 + 3) * TILE_SIZE, 6);
    expect(g.y).toBeCloseTo((3 + 3) * TILE_SIZE, 6);
    expect(g.width).toBeCloseTo(art.w * TILE_SIZE, 6);
    expect(g.height).toBeCloseTo(art.h * TILE_SIZE, 6);
  });

  it('paints the refused palette with its stripes, and the accepted one without', async () => {
    const bad = new OverlayLayer(() => {});
    bad.showGhost(mixedCellSet('terrain', cells(4, 4, 2)), { icon: 'eraser', valid: false });
    await frame();
    const polys = graphicsData(bad, 'ghostGraphics').filter((d) => (d.shape as { points?: number[] }).points !== undefined);
    expect(polys.length).toBeGreaterThan(2);
    for (const p of polys) expect(p.fillStyle?.color).toBe(PREVIEW_PALETTES.invalid.hatch);

    const good = new OverlayLayer(() => {});
    good.showGhost(mixedCellSet('terrain', cells(4, 4, 2)), { icon: 'eraser', valid: true });
    await frame();
    expect(graphicsData(good, 'ghostGraphics').filter((d) => (d.shape as { points?: number[] }).points !== undefined)).toHaveLength(0);
  });

  it('draws a placement wash as a square tint with no card marks', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGhost(mixedCellSet('terrain', [{ x: 3, y: 4 }, { x: 4, y: 4 }]), { wash: 'placement', valid: true });
    await frame();
    const data = graphicsData(overlay, 'ghostGraphics');
    const rects = data.filter((d) => typeof d.shape.width === 'number');
    expect(rects).toHaveLength(1);
    expect(rects[0]!.shape.radius).toBeUndefined();
    expect(rects[0]!.fillStyle?.color).toBe(washColor({ wash: 'placement', valid: true }));
    expect(data.filter((d) => d.shape.radius !== undefined && d.shape.width === undefined)).toHaveLength(0);
    expect(icon(overlay).visible).toBe(false);
  });

  it('drops the card when the ghost is cleared', async () => {
    const overlay = new OverlayLayer(() => {});
    overlay.showGhost(mixedCellSet('object', cells(1, 1, 2)), { icon: 'trim', valid: true });
    await frame();
    overlay.clearGhost();
    await frame();
    expect(graphicsData(overlay, 'ghostGraphics')).toHaveLength(0);
    expect(icon(overlay).visible).toBe(false);
  });
});
