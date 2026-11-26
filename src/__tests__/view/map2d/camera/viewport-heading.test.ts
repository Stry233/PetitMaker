/** The 2D camera's heading: every conversion, pan and zoom holds at any angle, Fit view returns
 *  the map to its home heading, and a fit into a box on the screen keeps it. */
import { describe, it, expect } from 'vitest';
import { Viewport, poseOfCamera, cameraOfPose } from '../../../../view/map2d/camera/viewport';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';
import { CULL_MARGIN_PX as MARGIN } from '../../../../view/map2d/geometry/chunk-cull';

const W = 800, H = 600;
const HEADINGS = [0, Math.PI / 2, 0.6458, Math.PI];

/** A viewport over a 40×30 map, zoomed and panned off its fit, turned to `heading`. */
function turned(heading: number): Viewport {
  const vp = new Viewport(W, H);
  vp.fitToMap(40, 30);
  vp.setZoom(1.3, 300, 200);
  vp.pan(25, -40);
  vp.turnBy(heading);
  return vp;
}

const centreMapPoint = (vp: Viewport) => vp.screenToPoint(W / 2, H / 2);

describe('a turned 2D viewport', () => {
  for (const heading of HEADINGS) {
    it(`round-trips map points through the screen at heading ${heading.toFixed(4)}`, () => {
      const vp = turned(heading);
      for (const p of [{ x: 3, y: 4 }, { x: 17.5, y: 9.25 }, { x: 39, y: 0 }]) {
        const s = vp.cellToScreen(p.x, p.y);
        const back = vp.screenToPoint(s.x, s.y);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    });
  }

  it('reports the heading it was turned to', () => {
    expect(turned(0.6458).getHeading()).toBeCloseTo(0.6458, 12);
  });

  it('turns about the canvas centre', () => {
    const vp = turned(0);
    const before = centreMapPoint(vp);
    vp.turnBy(1.1);
    const after = centreMapPoint(vp);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('turns the map counter-clockwise on screen for a positive heading', () => {
    const vp = turned(0);
    const c = centreMapPoint(vp);
    const east = { x: c.x + 2, y: c.y };
    vp.turnBy(0.3);
    expect(vp.cellToScreen(east.x, east.y).y).toBeLessThan(H / 2);
  });

  it('pans along the screen, whatever the heading', () => {
    const vp = turned(Math.PI / 2);
    const before = centreMapPoint(vp);
    vp.pan(10, 0);
    const after = centreMapPoint(vp);
    const zoom = vp.getZoom();
    expect(after.x).toBeCloseTo(before.x, 9);
    // A quarter turn counter-clockwise shows the map's +y (south) to the right.
    expect(after.y - before.y).toBeCloseTo(10 / zoom / TILE_SIZE, 9);
  });

  it('keeps the map point under the anchor while zooming at a heading', () => {
    const vp = turned(0.6458);
    const under = vp.screenToPoint(250, 420);
    vp.setZoom(vp.getZoom() * 1.7, 250, 420);
    const now = vp.screenToPoint(250, 420);
    expect(now.x).toBeCloseTo(under.x, 9);
    expect(now.y).toBeCloseTo(under.y, 9);
  });

  it('returns to the home heading on Fit view', () => {
    const vp = turned(2);
    vp.fitToMap(40, 30);
    expect(vp.getHeading()).toBe(0);
    expect(vp.fittedView(40, 30).heading).toBe(0);
  });

  it('carries the heading through its view state', () => {
    const vp = turned(1.2);
    const view = vp.getView();
    expect(view.heading).toBeCloseTo(1.2, 12);
    const other = new Viewport(W, H);
    other.fitToMap(40, 30);
    other.setView(view);
    expect(other.getHeading()).toBeCloseTo(1.2, 12);
    const s = vp.cellToScreen(5, 6), t = other.cellToScreen(5, 6);
    expect(t.x).toBeCloseTo(s.x, 9);
    expect(t.y).toBeCloseTo(s.y, 9);
  });

  it('bounds every canvas corner within the world rect it culls by', () => {
    const vp = turned(Math.PI / 4);
    const rect = vp.visibleWorldRect();
    for (const [sx, sy] of [[0, 0], [W, 0], [0, H], [W, H]] as const) {
      const p = vp.screenToPoint(sx, sy);
      const wx = p.x * TILE_SIZE, wy = p.y * TILE_SIZE;
      expect(wx).toBeGreaterThanOrEqual(rect.left);
      expect(wx).toBeLessThanOrEqual(rect.right);
      expect(wy).toBeGreaterThanOrEqual(rect.top);
      expect(wy).toBeLessThanOrEqual(rect.bottom);
    }
  });

  it('culls by the canvas mapped through world = (screen + offset) / zoom at the home heading', () => {
    const vp = new Viewport(W, H);
    vp.setView({ zoom: 2, offsetX: 1000, offsetY: 500 });
    expect(vp.visibleWorldRect()).toEqual({
      left: 500 - MARGIN, top: 250 - MARGIN, right: (W + 1000) / 2 + MARGIN, bottom: (H + 500) / 2 + MARGIN,
    });
  });

  it('names its pose as a saved camera, writing the heading only off the home heading', () => {
    expect(cameraOfPose({ zoom: 2, offsetX: 5, offsetY: 6, heading: 0 })).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(cameraOfPose({ zoom: 2, offsetX: 5, offsetY: 6, heading: 0.7 })).toEqual({ x: 5, y: 6, zoom: 2, rotation: 0.7 });
    expect(poseOfCamera({ x: 5, y: 6, zoom: 2 })).toEqual({ zoom: 2, offsetX: 5, offsetY: 6, heading: 0 });
    expect(poseOfCamera({ x: 5, y: 6, zoom: 2, rotation: 0.7 }).heading).toBe(0.7);
  });

  /** How many points of a 40×30 map's grid stand on a `w`×`h` canvas. */
  const onScreen = (vp: Viewport, w: number, h: number): number => {
    let n = 0;
    for (let y = 0; y <= 30; y++) for (let x = 0; x <= 40; x++) {
      const s = vp.cellToScreen(x, y);
      if (s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h) n++;
    }
    return n;
  };

  for (const [w, h] of [[1920, 1000], [390, 844]] as const) {
    for (const heading of [Math.PI / 4, Math.PI / 2, 2.3]) {
      it(`keeps some of the map on a ${w}×${h} canvas however far it is panned at heading ${heading.toFixed(2)}`, () => {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
          const vp = new Viewport(w, h);
          vp.fitToMap(40, 30);
          vp.turnBy(heading);
          vp.pan(dx * 1e5, dy * 1e5);
          expect(onScreen(vp, w, h), `panned (${dx}, ${dy})`).toBeGreaterThan(0);
        }
      });
    }
  }

  it('keeps some of the map on screen when a turn alone would carry it off', () => {
    const vp = new Viewport(1920, 1000);
    vp.fitToMap(40, 30);
    vp.pan(1e5, 0);
    vp.turnBy(Math.PI / 2);
    expect(onScreen(vp, 1920, 1000)).toBeGreaterThan(0);
  });

  it('stands a pose\'s heading within one turn, however many turns it names', () => {
    const vp = new Viewport(W, H);
    vp.setView({ zoom: 1, offsetX: 0, offsetY: 0, heading: 100 });
    expect(vp.getHeading()).toBeCloseTo(Math.atan2(Math.sin(100), Math.cos(100)), 12);
    expect(Math.abs(vp.getHeading())).toBeLessThanOrEqual(Math.PI);
  });
  for (const heading of HEADINGS) {
    it(`brings a map box centred into a box on the screen, as large as fits, at heading ${heading.toFixed(4)}`, () => {
      const vp = turned(heading);
      vp.setOrigin(10, 20);
      const box = { x: 12, y: 8, w: 6, h: 4 }, into = { left: 210, top: 70, width: 341, height: 200 };
      vp.setView(vp.boxedView(box, into));
      const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([x, y]) => vp.cellToScreen(x!, y!));
      const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
      const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      expect((left + right) / 2).toBeCloseTo(into.left + into.width / 2, 6);
      expect((top + bottom) / 2).toBeCloseTo(into.top + into.height / 2, 6);
      // It fills the box along one side and stays inside it along the other.
      expect(Math.max((right - left) / into.width, (bottom - top) / into.height)).toBeCloseTo(1, 6);
      expect(Math.cos(vp.getHeading())).toBeCloseTo(Math.cos(heading), 9);
      expect(Math.sin(vp.getHeading())).toBeCloseTo(Math.sin(heading), 9);
    });
  }
});
