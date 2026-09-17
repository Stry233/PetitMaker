import { describe, it, expect, vi } from 'vitest';
import { TiledMap, type RegionPx } from '../../../io/export/tiled-map';

/** A context that records where each captured tile is drawn. */
function recorder() {
  const draws: Array<{ region: RegionPx; dx: number; dy: number; dw: number; dh: number }> = [];
  const ctx = { drawImage: vi.fn((img: { region: RegionPx }, ...a: number[]) => { draws.push({ region: img.region, dx: a[4]!, dy: a[5]!, dw: a[6]!, dh: a[7]! }); }) } as unknown as CanvasRenderingContext2D;
  return { ctx, draws };
}

describe('the tiled map source', () => {
  const captures: RegionPx[] = [];
  const capture = (region: RegionPx) => { captures.push(region); return { region } as unknown as CanvasImageSource; };

  it('captures only the rows and columns a window shows, in tiles no larger than the cap, drawn 1:1 at Original', () => {
    captures.length = 0;
    const map = new TiledMap(10000, 8000, capture, 4096);
    const { ctx, draws } = recorder();
    const dest = { x: 100, y: 200, w: 10000, h: 8000 };
    map.draw(ctx, dest, { left: 0, top: 1224, right: 10100, bottom: 2248 });
    // Source rows 1024..2048 of the map, every column, since the window spans the whole width.
    expect(captures.every((r) => r.y === 1024 && r.h === 1024 && r.w <= 4096)).toBe(true);
    expect(captures.reduce((n, r) => n + r.w, 0)).toBe(10000);
    expect(draws.every((d) => d.dx === dest.x + d.region.x && d.dy === dest.y + d.region.y && d.dw === d.region.w && d.dh === d.region.h)).toBe(true);
  });

  it('clips the capture to the map and to the window on both axes', () => {
    captures.length = 0;
    const map = new TiledMap(500, 400, capture, 4096);
    const { ctx } = recorder();
    map.draw(ctx, { x: 10, y: 10, w: 500, h: 400 }, { left: 300, top: 350, right: 900, bottom: 600 });
    expect(captures).toEqual([{ x: 290, y: 340, w: 210, h: 60 }]);
  });

  it('draws nothing for a window that misses the map, and everything without a window', () => {
    captures.length = 0;
    const map = new TiledMap(300, 200, capture, 4096);
    const { ctx, draws } = recorder();
    map.draw(ctx, { x: 0, y: 0, w: 300, h: 200 }, { left: 0, top: 500, right: 300, bottom: 600 });
    expect(draws).toEqual([]);
    map.draw(ctx, { x: 0, y: 0, w: 300, h: 200 });
    expect(captures).toEqual([{ x: 0, y: 0, w: 300, h: 200 }]);
  });

  it('scales tiles with the destination when the map is drawn smaller than native', () => {
    captures.length = 0;
    const map = new TiledMap(1000, 800, capture, 4096);
    const { ctx, draws } = recorder();
    map.draw(ctx, { x: 0, y: 0, w: 500, h: 400 });
    expect(draws).toEqual([{ region: { x: 0, y: 0, w: 1000, h: 800 }, dx: 0, dy: 0, dw: 500, dh: 400 }]);
  });
});
