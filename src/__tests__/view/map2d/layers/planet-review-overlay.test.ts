// @vitest-environment jsdom
/** A scanned planet's cells to check in the 2D overlay: a wash with its outline, and the landmark's outline. */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { cellSet } from '../../../../core/grid/grids';
import { overlayPart } from '../../../_support/overlay-parts';

const graphics = (layer: OverlayLayer) => overlayPart<PIXI.Graphics>(layer, 'reviewGraphics');

describe('OverlayLayer review cells', () => {
  it('draws the cells and the landmark, below the planet frame, and clears them for no cells', () => {
    const layer = new OverlayLayer(() => {});
    layer.showCellMarks(cellSet('object', [{ x: 3, y: 4 }, { x: 4, y: 4 }]), { x: 10, y: 10, w: 20, h: 27 });
    const g = graphics(layer);
    expect(g.geometry.graphicsData.length).toBeGreaterThan(0);
    const frame = overlayPart<PIXI.Graphics>(layer, 'planetFrameGraphics');
    expect(g.parent.getChildIndex(g)).toBeLessThan(frame.parent.getChildIndex(frame));
    layer.showCellMarks(null, null);
    expect(g.geometry.graphicsData.length).toBe(0);
  });

  it('outlines the landmark alone when no cell needs a look', () => {
    const layer = new OverlayLayer(() => {});
    layer.showCellMarks(cellSet('object', []), { x: 10, y: 10, w: 20, h: 27 });
    expect(graphics(layer).geometry.graphicsData.length).toBeGreaterThan(0);
  });
});
