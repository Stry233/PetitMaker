/**
 * THE 2D VIEWPORT SPEAKS THE WINDOW'S COORDINATES, not its own canvas's.
 *
 * `ViewProjection`'s screen numbers are client px on both live views: the pointer machine hands
 * `clientX`/`clientY` straight in, and the React chrome anchors to what comes back. Both views read
 * where their canvas stands at use; `setOrigin` is the constant reading, for a surface no layout
 * moves, and these are the conversions it must hold together while the canvas is inset from the
 * window's left edge.
 */
import { describe, it, expect } from 'vitest';
import { Viewport } from '../../canvas/map2d/viewport';
import { TILE_SIZE } from '../../core/model/constants';

/** A canvas 1200x800 standing 400px in from the window's left, the shape a docked panel leaves. */
function inset(): Viewport {
  const vp = new Viewport(1200, 800);
  vp.setOrigin(400, 0);
  return vp;
}

describe('a screen point is a window point', () => {
  it('reads the same cell under a client point as the un-inset canvas reads under its own', () => {
    const flush = new Viewport(1200, 800);
    const shifted = inset();
    for (const [x, y] of [[0, 0], [130, 200], [1199, 799]] as const) {
      expect(shifted.screenToMacro(x + 400, y)).toEqual(flush.screenToMacro(x, y));
      expect(shifted.screenToMicro(x + 400, y)).toEqual(flush.screenToMicro(x, y));
      expect(shifted.screenToHalf(x + 400, y)).toEqual(flush.screenToHalf(x, y));
    }
  });

  it('answers with client px, so a cell and the point that picked it agree', () => {
    const vp = inset();
    vp.fitToMap(24, 24);
    for (const [cx, cy] of [[0, 0], [7, 3], [23, 23]] as const) {
      const at = vp.cellToScreen(cx, cy);
      // The corner's own point, nudged inside the cell, must pick the cell back.
      expect(vp.screenToMacro(at.x + at.scale / 2, at.y + at.scale / 2)).toEqual({ x: cx, y: cy });
    }
  });

  it('frames the map inside the canvas, not inside the window', () => {
    const vp = inset();
    vp.fitToMap(24, 24);
    const tl = vp.cellToScreen(0, 0);
    const br = vp.cellToScreen(24, 24);
    // The map's own centre lands on the CANVAS's centre, which is the window's centre plus the inset.
    expect((tl.x + br.x) / 2).toBeCloseTo(400 + 600, 6);
    expect((tl.y + br.y) / 2).toBeCloseTo(400, 6);
  });
});

describe('a zoom anchor is a window point too', () => {
  it('holds the world point under the anchor while the zoom changes', () => {
    const vp = inset();
    vp.fitToMap(24, 24);
    const anchor = { x: 900, y: 300 };
    const before = vp.screenToMacro(anchor.x, anchor.y);
    vp.setZoom(vp.getZoom() * 2.5, anchor.x, anchor.y);
    expect(vp.screenToMacro(anchor.x, anchor.y)).toEqual(before);
  });

  it('is unmoved by the origin, since a pan is a delta and not a place', () => {
    const flush = new Viewport(1200, 800);
    const shifted = inset();
    flush.fitToMap(24, 24);
    shifted.fitToMap(24, 24);
    flush.pan(37, -11);
    shifted.pan(37, -11);
    expect(shifted.cellToScreen(5, 5).x - 400).toBeCloseTo(flush.cellToScreen(5, 5).x, 6);
    expect(shifted.cellToScreen(5, 5).y).toBeCloseTo(flush.cellToScreen(5, 5).y, 6);
  });
});

describe('the origin is a place the canvas can be moved to', () => {
  it('carries the camera with it rather than re-framing the map', () => {
    const vp = new Viewport(1200, 800);
    vp.fitToMap(24, 24);
    const before = vp.cellToScreen(6, 6);
    vp.setOrigin(400, 0);
    // The same cell is drawn 400px further right: the camera did not move, the canvas did.
    expect(vp.cellToScreen(6, 6).x).toBeCloseTo(before.x + 400, 6);
    expect(vp.cellToScreen(6, 6).y).toBeCloseTo(before.y, 6);
    expect(vp.getView()).toEqual({ zoom: vp.getZoom(), offsetX: vp.getOffset().x, offsetY: vp.getOffset().y });
  });

  it('starts at the window\'s own corner, which is where a full-window canvas stands', () => {
    const vp = new Viewport(1200, 800);
    expect(vp.macroToScreen({ x: 2, y: 3 })).toEqual({ x: 2 * TILE_SIZE, y: 3 * TILE_SIZE });
  });
});
