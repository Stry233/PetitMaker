/**
 * The overlay's grey hover-preview box: drawn under the orange selection ring,
 * keyed so a stationary hover doesn't redraw per mousemove, cleared cleanly.
 */
import './_pixi-env';
import { describe, it, expect } from 'vitest';
import { OverlayLayer } from '../../canvas/map2d/layers/overlay-layer';

describe('OverlayLayer hover box', () => {
  it('draws, dedupes a repeated box, and clears', () => {
    const overlay = new OverlayLayer();
    const g = (overlay as unknown as { hoverGraphics: { geometry: { graphicsData: unknown[] } } }).hoverGraphics;
    overlay.showHover(4, 5, 3, 2, false);
    const drawn = g.geometry.graphicsData.length;
    expect(drawn).toBeGreaterThan(0);
    overlay.showHover(4, 5, 3, 2, false); // same box → no rebuild
    expect(g.geometry.graphicsData.length).toBe(drawn);
    overlay.clearHover();
    expect(g.geometry.graphicsData.length).toBe(0);
  });

  it('sits below the selection ring in the paint order', () => {
    const overlay = new OverlayLayer();
    const inner = overlay as unknown as { hoverGraphics: unknown; selectionGraphics: unknown };
    const kids = overlay.container.children as unknown[];
    expect(kids.indexOf(inner.hoverGraphics)).toBeGreaterThanOrEqual(0);
    expect(kids.indexOf(inner.hoverGraphics)).toBeLessThan(kids.indexOf(inner.selectionGraphics));
  });
});


describe('editable curve footprint', () => {
  it('survives clearing pointer ghosts and releases its geometry on dismissal', () => {
    const overlay = new OverlayLayer();
    const g = (overlay as unknown as { curveGraphics: { geometry: { graphicsData: unknown[] } } }).curveGraphics;
    overlay.showCurveFootprint([{ x: 4, y: 5 }, { x: 5, y: 5 }], true);
    expect(g.geometry.graphicsData.length).toBeGreaterThan(0);
    overlay.clearGhost();
    expect(g.geometry.graphicsData.length).toBeGreaterThan(0);
    overlay.clearCurveFootprint();
    expect(g.geometry.graphicsData.length).toBe(0);
    overlay.container.destroy({ children: true });
  });
});
