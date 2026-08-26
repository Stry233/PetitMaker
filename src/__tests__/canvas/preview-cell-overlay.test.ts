/**
 * THE PREVIEW CARD, as the 2D overlay draws it.
 *
 * The pure geometry is pinned in `core/preview-cell.test.ts`; this is the wiring: a ghost handed a
 * PreviewCell paints the card (one background at the footprint, four dots at the footprint's own
 * corners, the glyph at 1x1 size in the middle) on the grid the caller named, and a ghost handed a
 * plain tint still paints the old wash with nothing extra.
 */
import './_pixi-env';
import { describe, it, expect, vi } from 'vitest';

// jsdom has no Path2D, so the shared rasteriser can draw nothing there. The glyph's SIZE and PLACE
// are what this file is about, so it is handed a blank canvas of the right shape instead.
vi.mock('../../canvas/preview-cell-raster', () => ({
  HATCH_CELLS: 3,
  previewIconCanvas: () => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    return c;
  },
  previewHatchCanvas: () => null,
}));
import { OverlayLayer } from '../../canvas/map2d/layers/overlay-layer';
import { TILE_SIZE } from '../../core/model/constants';
import { HALF_TILE } from '../../core/model/grid-model';
import {
  PREVIEW_CELL_ART, PREVIEW_ICON_ART, PREVIEW_PALETTES, previewDots,
} from '../../core/runtime/preview-cell';

interface Shape { x: number; y: number; width?: number; height?: number; radius?: number; type?: number }
interface Data { shape: Shape; fillStyle?: { color: number; alpha: number }; lineStyle?: { color: number; width: number; alpha: number } }

function graphicsData(overlay: OverlayLayer, field: string): Data[] {
  const g = (overlay as unknown as Record<string, { geometry: { graphicsData: Data[] } }>)[field]!;
  return g.geometry.graphicsData;
}

const icon = (overlay: OverlayLayer) =>
  (overlay as unknown as { previewIcon: { visible: boolean; x: number; y: number; width: number; height: number } }).previewIcon;

const frame = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => r()); });

const cells = (x: number, y: number, n: number) =>
  Array.from({ length: n * n }, (_, i) => ({ x: x + (i % n), y: y + Math.floor(i / n) }));

describe('the preview card in the 2D overlay', () => {
  it('draws ONE background over the whole footprint, on the terrain grid', async () => {
    const overlay = new OverlayLayer();
    overlay.showGhost(cells(4, 6, 3), { icon: 'mountain', valid: true }, true);
    await frame();
    const rects = graphicsData(overlay, 'ghostGraphics').filter((d) => typeof d.shape.width === 'number');
    // one fill + one stroke pass over the same rect
    expect(rects.length).toBe(2);
    for (const r of rects) {
      expect(r.shape.x).toBeCloseTo(4 * TILE_SIZE - HALF_TILE, 6);
      expect(r.shape.y).toBeCloseTo(6 * TILE_SIZE - HALF_TILE, 6);
      expect(r.shape.width).toBeCloseTo(3 * TILE_SIZE, 6);
      expect(r.shape.height).toBeCloseTo(3 * TILE_SIZE, 6);
      expect(r.shape.radius).toBeCloseTo(PREVIEW_CELL_ART.radius * TILE_SIZE, 6);
    }
  });

  it('puts the four dots at the footprint corners, in the palette colour, whatever the size', async () => {
    for (const n of [1, 5]) {
      const overlay = new OverlayLayer();
      overlay.showGhost(cells(10, 20, n), { icon: 'ground', valid: true }, false);
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
    const overlay = new OverlayLayer();
    overlay.showGhost(cells(2, 3, 6), { icon: 'water', valid: true }, false);
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
    const bad = new OverlayLayer();
    bad.showGhost(cells(4, 4, 2), { icon: 'eraser', valid: false }, true);
    await frame();
    const polys = graphicsData(bad, 'ghostGraphics').filter((d) => (d.shape as { points?: number[] }).points !== undefined);
    expect(polys.length).toBeGreaterThan(2);
    for (const p of polys) expect(p.fillStyle?.color).toBe(PREVIEW_PALETTES.invalid.hatch);

    const good = new OverlayLayer();
    good.showGhost(cells(4, 4, 2), { icon: 'eraser', valid: true }, true);
    await frame();
    expect(graphicsData(good, 'ghostGraphics').filter((d) => (d.shape as { points?: number[] }).points !== undefined)).toHaveLength(0);
  });

  it('leaves a plain-tint ghost exactly as it was: a square wash, no card marks', async () => {
    const overlay = new OverlayLayer();
    overlay.showGhost([{ x: 3, y: 4 }, { x: 4, y: 4 }], 0x22c55e, true);
    await frame();
    const data = graphicsData(overlay, 'ghostGraphics');
    const rects = data.filter((d) => typeof d.shape.width === 'number');
    expect(rects).toHaveLength(1);
    expect(rects[0]!.shape.radius).toBeUndefined();
    expect(rects[0]!.fillStyle?.color).toBe(0x22c55e);
    expect(data.filter((d) => d.shape.radius !== undefined && d.shape.width === undefined)).toHaveLength(0);
    expect(icon(overlay).visible).toBe(false);
  });

  it('drops the card when the ghost is cleared', async () => {
    const overlay = new OverlayLayer();
    overlay.showGhost(cells(1, 1, 2), { icon: 'trim', valid: true }, false);
    await frame();
    overlay.clearGhost();
    await frame();
    expect(graphicsData(overlay, 'ghostGraphics')).toHaveLength(0);
    expect(icon(overlay).visible).toBe(false);
  });
});
