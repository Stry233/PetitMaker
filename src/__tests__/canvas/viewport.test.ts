import { describe, it, expect } from 'vitest';
import { Viewport } from '../../canvas/map2d/viewport';
import { PAN_KEEP_PX } from '../../core/model/constants';
import { TILE_SIZE, ZOOM_MIN, ZOOM_MAX } from '../../core/model/constants';

describe('Viewport', () => {
  it('converts macro to screen at default zoom/pan', () => {
    const vp = new Viewport(800, 600);
    // Default zoom=1, offset=(0,0)
    const s = vp.macroToScreen({ x: 2, y: 3 });
    expect(s.x).toBe(2 * TILE_SIZE);
    expect(s.y).toBe(3 * TILE_SIZE);
  });

  it('converts screen to macro at default zoom', () => {
    const vp = new Viewport(800, 600);
    // Pixel (130, 200) with TILE_SIZE=64 → macro (2, 3)
    const m = vp.screenToMacro(130, 200);
    expect(m.x).toBe(2); // floor(130/64) = 2
    expect(m.y).toBe(3); // floor(200/64) = 3
  });

  it('screenToMacro accounts for zoom', () => {
    const vp = new Viewport(800, 600);
    vp.setZoom(2, 0, 0);
    // At zoom=2 with anchor at (0,0): offset stays (0,0)
    // world = (screen + offset) / zoom = (128 + 0) / 2 = 64
    // macro = floor(64 / 64) = 1
    const m = vp.screenToMacro(128, 128);
    expect(m.x).toBe(1);
    expect(m.y).toBe(1);
  });

  it('cellToScreen returns the cell corner plus the projected cell size (ViewProjection contract)', () => {
    const vp = new Viewport(800, 600);
    vp.setZoom(2, 0, 0);
    vp.pan(50, 30);
    const c = vp.cellToScreen(3, 4);
    expect(c.x).toBe(3 * TILE_SIZE * 2 - 50);
    expect(c.y).toBe(4 * TILE_SIZE * 2 - 30);
    expect(c.scale).toBe(TILE_SIZE * 2);
  });

  it('screenToMacro accounts for pan offset', () => {
    const vp = new Viewport(800, 600);
    vp.pan(64, 128);
    // world = (screen + offset) / zoom = (0 + 64) / 1 = 64, (0 + 128) / 1 = 128
    // macro = floor(64/64) = 1, floor(128/64) = 2
    const m = vp.screenToMacro(0, 0);
    expect(m.x).toBe(1);
    expect(m.y).toBe(2);
  });

  it('clamps zoom to min/max', () => {
    const vp = new Viewport(800, 600);
    vp.setZoom(0.01, 400, 300);
    expect(vp.getZoom()).toBe(ZOOM_MIN);

    vp.setZoom(100, 400, 300);
    expect(vp.getZoom()).toBe(ZOOM_MAX);
  });

  it('zoom-at centers zoom on cursor position', () => {
    const vp = new Viewport(800, 600);
    // Anchor at screen (200, 150). Default zoom=1, offset=(0,0).
    // World under anchor = (200, 150).
    // After zoom to 2: offset = 200*2 - 200 = 200, 150*2 - 150 = 150
    vp.setZoom(2, 200, 150);
    expect(vp.getZoom()).toBe(2);

    // The world coordinate under screen (200,150) should still be (200, 150)
    const world = vp.screenToWorld(200, 150);
    expect(world.x).toBeCloseTo(200, 5);
    expect(world.y).toBeCloseTo(150, 5);
  });

  it('fitToMap sets valid zoom', () => {
    const vp = new Viewport(800, 600);
    // Map 20x20: world = 1280x1280
    // scaleX = 800/1280 = 0.625, scaleY = 600/1280 ≈ 0.469
    // zoom = min(0.625, 0.469) ≈ 0.469
    vp.fitToMap(20, 20);
    const z = vp.getZoom();
    expect(z).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(z).toBeLessThanOrEqual(ZOOM_MAX);
    // Zoom should be approximately 0.469
    expect(z).toBeCloseTo(600 / (20 * TILE_SIZE), 5);
  });

  it('screenToMicro returns sub-cell coordinates', () => {
    const vp = new Viewport(800, 600);
    // TILE_SIZE=64, half=32
    // Pixel (33, 65): world=(33,65), micro = floor(33/32)=1, floor(65/32)=2
    const micro = vp.screenToMicro(33, 65);
    expect(micro.x).toBe(1);
    expect(micro.y).toBe(2);

    // Pixel (0, 0) → micro (0, 0)
    const origin = vp.screenToMicro(0, 0);
    expect(origin.x).toBe(0);
    expect(origin.y).toBe(0);
  });

  it('screenToHalf rounds to the nearest half-cell grid point', () => {
    const vp = new Viewport(800, 600);
    // TILE_SIZE=64. Pixel (16, 80): world=(16,80). x: 16/64=0.25, *2=0.5, round=1, /2=0.5.
    // y: 80/64=1.25, *2=2.5, round=3, /2=1.5.
    const half = vp.screenToHalf(16, 80);
    expect(half.x).toBe(0.5);
    expect(half.y).toBe(1.5);

    // A whole-cell pixel lands exactly on the same integer screenToMacro already gives.
    const whole = vp.screenToHalf(64, 128);
    expect(whole).toEqual({ x: 1, y: 2 });
    expect(whole).toEqual(vp.screenToMacro(64, 128));

    expect(vp.screenToHalf(0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('pan bounds', () => {
  // 100x100 map at zoom 1 = 6400px world; canvas 800x600. At least PAN_KEEP_PX
  // of map must stay visible on each axis — the map can never be lost off-screen.
  function boundedViewport() {
    const v = new Viewport(800, 600);
    v.fitToMap(100, 100);
    v.setView({ zoom: 1, offsetX: 0, offsetY: 0 });
    return v;
  }

  it('panning far past the map clamps with a strip still visible', () => {
    const v = boundedViewport();
    v.pan(1e9, 1e9);
    const o = v.getOffset();
    expect(o.x).toBe(100 * 64 - PAN_KEEP_PX); // map right edge keeps PAN_KEEP_PX on screen
    expect(o.y).toBe(100 * 64 - PAN_KEEP_PX);
    v.pan(-1e9, -1e9);
    expect(v.getOffset().x).toBe(PAN_KEEP_PX - 800);
    expect(v.getOffset().y).toBe(PAN_KEEP_PX - 600);
  });

  it('setView beyond the bounds clamps the restored camera', () => {
    const v = boundedViewport();
    v.setView({ zoom: 1, offsetX: 1e7, offsetY: -1e7 });
    expect(v.getOffset().x).toBe(100 * 64 - PAN_KEEP_PX);
    expect(v.getOffset().y).toBe(PAN_KEEP_PX - 600);
  });

  it('fitToMap centring stays untouched when the map is smaller than the canvas', () => {
    const v = new Viewport(800, 600);
    v.fitToMap(4, 4); // 256px world, fits easily
    const o = v.getOffset();
    // centered: non-positive offsets place the map mid-canvas
    expect(o.x).toBeLessThan(0);
    expect(o.y).toBeLessThanOrEqual(0);
    // and a wild pan still keeps half the small map visible
    v.pan(1e9, 0);
    const mapPx = 4 * 64 * v.getZoom();
    expect(v.getOffset().x).toBeCloseTo(mapPx - Math.min(160, mapPx / 2), 5);
  });

  it('a viewport with no map yet pans freely', () => {
    const v = new Viewport(800, 600);
    v.pan(5000, 5000);
    expect(v.getOffset()).toEqual({ x: 5000, y: 5000 });
  });
});
