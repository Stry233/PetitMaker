/**
 * The planet session's live frame: the chunk-bounds dashes limited to the planet's chunks, drawn in
 * the 2D overlay, and one flash that says the planet has reached its size limit.
 */
import './_pixi-env';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { chunkGridRects, planetFrameRects } from '../../canvas/reference-grid';
import { OverlayLayer } from '../../canvas/map2d/layers/overlay-layer';
import { __resetMotionState, setReducedMotion } from '../../core/runtime/motion-state';
import { CHUNK_SIZE } from '../../core/model/game-profile';

const frame = { x0: 16, y0: 32, cols: 2, rows: 1 };

describe('planetFrameRects', () => {
  it('are the chunk-bounds dashes of the frame and stay inside it', () => {
    const rects = planetFrameRects(frame, 1 / 8);
    const chunkMap = { width: 48, height: 48, chunkGrid: { origin: { x: 16, y: 32 }, columns: 2, rows: 1 } };
    expect(rects).toEqual(chunkGridRects(chunkMap, 1 / 8));
    expect(Math.min(...rects.map((r) => r.x))).toBe(16);
    expect(Math.min(...rects.map((r) => r.y))).toBe(32);
    expect(Math.max(...rects.map((r) => r.x + r.width))).toBe(16 + 2 * CHUNK_SIZE);
    expect(Math.max(...rects.map((r) => r.y + r.height))).toBe(32 + CHUNK_SIZE);
  });
});

describe('OverlayLayer planet frame', () => {
  afterEach(() => { __resetMotionState(); vi.restoreAllMocks(); });

  const frameGraphics = (layer: OverlayLayer) =>
    (layer as unknown as { planetFrameGraphics: PIXI.Graphics }).planetFrameGraphics;

  it('draws the frame and clears it for no frame', () => {
    const layer = new OverlayLayer();
    layer.showPlanetFrame(frame);
    expect(frameGraphics(layer).geometry.graphicsData.length).toBeGreaterThan(0);
    expect((layer as unknown as { planetFrameFlash: PIXI.Graphics }).planetFrameFlash.alpha, 'no warning tint at rest').toBe(0);
    layer.showPlanetFrame(null);
    expect(frameGraphics(layer).geometry.graphicsData.length).toBe(0);
  });

  it('a flash requested while one runs does not restart it', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const layer = new OverlayLayer();
    layer.showPlanetFrame(frame);
    layer.flashPlanetFrame(900);
    layer.flashPlanetFrame(900);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('cancels a running flash when it is ended, as the renderer does on teardown', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const layer = new OverlayLayer();
    layer.showPlanetFrame(frame);
    layer.flashPlanetFrame(900);
    layer.endPlanetFlash();
    expect(cancel).toHaveBeenCalledWith(7);
    expect((layer as unknown as { planetFrameFlash: PIXI.Graphics }).planetFrameFlash.alpha).toBe(0);
  });

  it('does not animate under reduced motion', () => {
    setReducedMotion(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const layer = new OverlayLayer();
    layer.showPlanetFrame(frame);
    layer.flashPlanetFrame(900);
    expect(raf).not.toHaveBeenCalled();
  });

  it('has nothing to flash without a frame', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    new OverlayLayer().flashPlanetFrame(900);
    expect(raf).not.toHaveBeenCalled();
  });
});
