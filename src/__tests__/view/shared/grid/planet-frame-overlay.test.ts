// @vitest-environment jsdom
/**
 * The planet session's live frame: the chunk-bounds dashes limited to the planet's chunks, drawn in
 * the 2D overlay, and one flash that says the planet has reached its size limit.
 */
import '../../../_support/pixi-env';
import { describe, it, expect, afterEach } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { chunkGridRects, planetFrameRects } from '../../../../view/shared/grid/reference-grid';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { __resetMotionState, setReducedMotion } from '../../../../platform/channels/motion-state';
import { CHUNK_SIZE } from '../../../../core/game/profile';
import { overlayPart } from '../../../_support/overlay-parts';
import { beatClock } from '../../../_support/beat-clock';

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
  afterEach(() => { __resetMotionState(); });

  const frameGraphics = (layer: OverlayLayer) =>
    overlayPart<PIXI.Graphics>(layer, 'planetFrameGraphics');

  it('draws the frame and clears it for no frame', () => {
    const layer = new OverlayLayer(() => {});
    layer.showFrame(frame);
    expect(frameGraphics(layer).geometry.graphicsData.length).toBeGreaterThan(0);
    expect(overlayPart<PIXI.Graphics>(layer, 'planetFrameFlash').alpha, 'no warning tint at rest').toBe(0);
    layer.showFrame(null);
    expect(frameGraphics(layer).geometry.graphicsData.length).toBe(0);
  });

  it('a flash requested while one runs does not restart it', () => {
    const loop = beatClock();
    const layer = new OverlayLayer(() => {}, () => null, loop.play);
    layer.showFrame(frame);
    layer.flashFrame(900);
    layer.flashFrame(900);
    expect(loop.played).toBe(1);
  });

  it('rises and falls once over its duration, then rests', () => {
    const loop = beatClock();
    const layer = new OverlayLayer(() => {}, () => null, loop.play);
    const tint = () => overlayPart<PIXI.Graphics>(layer, 'planetFrameFlash').alpha;
    layer.showFrame(frame);
    layer.flashFrame(900);
    loop.frame(100);
    expect(tint()).toBe(0);
    loop.frame(100 + 450);
    expect(tint()).toBeCloseTo(1, 9);
    expect(loop.frame(100 + 900)).toBe(false);
    expect(tint()).toBe(0);
  });

  it('cancels a running flash when it is ended, as the renderer does on teardown', () => {
    const loop = beatClock();
    const layer = new OverlayLayer(() => {}, () => null, loop.play);
    layer.showFrame(frame);
    layer.flashFrame(900);
    loop.frame(0);
    loop.frame(300);
    layer.endFrameFlash();
    expect(loop.frame(400)).toBe(false);
    expect(overlayPart<PIXI.Graphics>(layer, 'planetFrameFlash').alpha).toBe(0);
  });

  it('does not animate under reduced motion', () => {
    setReducedMotion(true);
    const loop = beatClock();
    const layer = new OverlayLayer(() => {}, () => null, loop.play);
    layer.showFrame(frame);
    layer.flashFrame(900);
    expect(loop.played).toBe(0);
  });

  it('has nothing to flash without a frame', () => {
    const loop = beatClock();
    new OverlayLayer(() => {}, () => null, loop.play).flashFrame(900);
    expect(loop.played).toBe(0);
  });
});
