// @vitest-environment jsdom
/**
 * The overlay's grey hover-preview box: drawn under the orange selection ring,
 * keyed so a stationary hover doesn't redraw per mousemove, cleared cleanly.
 */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import { OverlayLayer } from '../../../../view/map2d/layers/overlay-layer';
import { cellSet } from '../../../../core/grid/grids';
import { overlayPart } from '../../../_support/overlay-parts';

describe('OverlayLayer hover box', () => {
  it('draws, dedupes a repeated box, and clears', () => {
    const overlay = new OverlayLayer(() => {});
    const g = overlayPart<{ geometry: { graphicsData: unknown[] } }>(overlay, 'hoverGraphics');
    overlay.showHover({ x: 4, y: 5, w: 3, h: 2 }, 'object');
    const drawn = g.geometry.graphicsData.length;
    expect(drawn).toBeGreaterThan(0);
    overlay.showHover({ x: 4, y: 5, w: 3, h: 2 }, 'object'); // same box → no rebuild
    expect(g.geometry.graphicsData.length).toBe(drawn);
    overlay.clearHover();
    expect(g.geometry.graphicsData.length).toBe(0);
  });

  it('sits below the selection ring in the paint order', () => {
    const overlay = new OverlayLayer(() => {});
    const hover = overlayPart<unknown>(overlay, 'hoverGraphics'), selection = overlayPart<unknown>(overlay, 'selectionGraphics');
    const kids = overlay.container.children as unknown[];
    expect(kids.indexOf(hover)).toBeGreaterThanOrEqual(0);
    expect(kids.indexOf(hover)).toBeLessThan(kids.indexOf(selection));
  });
});


describe('editable curve footprint', () => {
  it('survives clearing pointer ghosts and releases its geometry on dismissal', async () => {
    const overlay = new OverlayLayer(() => {});
    const g = overlayPart<{ geometry: { graphicsData: unknown[] } }>(overlay, 'curveGraphics');
    overlay.showCurveFootprint(cellSet('terrain', [{ x: 4, y: 5 }, { x: 5, y: 5 }]));
    expect(g.geometry.graphicsData.length).toBeGreaterThan(0);
    overlay.clearGhost();
    expect(g.geometry.graphicsData.length).toBeGreaterThan(0);
    overlay.clearCurveFootprint();
    expect(g.geometry.graphicsData.length).toBe(0);
    // Torn down the way MapRenderer does it: dispose cancels the ghost frame clearGhost scheduled,
    // so nothing draws into the destroyed Graphics on the next frame.
    overlay.dispose();
    overlay.container.destroy({ children: true });
    await new Promise<void>((frame) => requestAnimationFrame(() => frame()));
  });
});
