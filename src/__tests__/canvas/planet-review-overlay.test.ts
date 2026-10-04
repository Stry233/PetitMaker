/** A scanned planet's cells to check in the 2D overlay: a wash with its outline, and the landmark's outline. */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { OverlayLayer } from '../../canvas/map2d/layers/overlay-layer';

const graphics = (layer: OverlayLayer) => (layer as unknown as { reviewGraphics: PIXI.Graphics }).reviewGraphics;

describe('OverlayLayer review cells', () => {
  it('draws the cells and the landmark, below the planet frame, and clears them for no cells', () => {
    const layer = new OverlayLayer();
    layer.showReviewCells([{ x: 3, y: 4 }, { x: 4, y: 4 }], { x: 10, y: 10, w: 20, h: 27 });
    const g = graphics(layer);
    expect(g.geometry.graphicsData.length).toBeGreaterThan(0);
    const frame = (layer as unknown as { planetFrameGraphics: PIXI.Graphics }).planetFrameGraphics;
    expect(g.parent.getChildIndex(g)).toBeLessThan(frame.parent.getChildIndex(frame));
    layer.showReviewCells(null, null);
    expect(g.geometry.graphicsData.length).toBe(0);
  });

  it('outlines the landmark alone when no cell needs a look', () => {
    const layer = new OverlayLayer();
    layer.showReviewCells([], { x: 10, y: 10, w: 20, h: 27 });
    expect(graphics(layer).geometry.graphicsData.length).toBeGreaterThan(0);
  });
});
