/**
 * A BOX CHANGE MOVES THE BOX'S CENTRE, AND THE 2D WORLD FOLLOWS IT.
 *
 * The map canvas is a layer of the interface, not the page under it: the assistant's dock takes a
 * strip of the window, so the box's size AND place change while the scene inside should keep reading
 * as the same scene. The camera therefore anchors the world point at the box's centre through every
 * resize — the 3D view's own behaviour, whose projection is about its box centre and takes only the
 * aspect from a resize. It is also what makes the dock choreography land silently: the slide carries
 * the drawing by HALF the dock's width, which is exactly the centre's travel, so the one resize at
 * each end of the slide moves nothing on screen.
 */
import './_pixi-env';
import { describe, it, expect, afterEach } from 'vitest';
import { MapRenderer } from '../../canvas/map2d/map-renderer';
import { Viewport } from '../../canvas/map2d/viewport';
import { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../core/model/types';

const renderers: MapRenderer[] = [];

interface Box { left: number; top: number; width: number; height: number }

/** A renderer over a container whose client box the test moves, as the dock does. */
function makeRenderer(box: Box): MapRenderer {
  const container = document.createElement('div');
  container.getBoundingClientRect = () =>
    ({ left: box.left, top: box.top, x: box.left, y: box.top, width: box.width, height: box.height,
      right: box.left + box.width, bottom: box.top + box.height, toJSON: () => ({}) }) as DOMRect;
  const r = new MapRenderer(new EventBus<EditorEvents>(), container, box.width, box.height);
  renderers.push(r);
  return r;
}

afterEach(() => {
  for (const r of renderers.splice(0)) r.destroy();
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
});

describe('the viewport anchors the box centre through a resize', () => {
  it('keeps the world point at the centre where the box narrows', () => {
    const vp = new Viewport(1440, 900);
    vp.fitToMap(24, 24);
    vp.pan(37, -11);
    const centre = vp.screenToWorld(1440 / 2, 900 / 2);
    vp.resize(1024, 900);
    const after = vp.screenToWorld(1024 / 2, 900 / 2);
    expect(after.x).toBeCloseTo(centre.x, 6);
    expect(after.y).toBeCloseTo(centre.y, 6);
  });

  it('keeps the world point at the centre where the box shortens', () => {
    const vp = new Viewport(1440, 900);
    vp.fitToMap(24, 24);
    const centre = vp.screenToWorld(1440 / 2, 900 / 2);
    vp.resize(1440, 700);
    const after = vp.screenToWorld(1440 / 2, 700 / 2);
    expect(after.x).toBeCloseTo(centre.x, 6);
    expect(after.y).toBeCloseTo(centre.y, 6);
  });

  it('keeps the zoom: adapting the frame is a framing move, not a scale move', () => {
    const vp = new Viewport(1440, 900);
    vp.fitToMap(24, 24);
    const z = vp.getZoom();
    vp.resize(1024, 900);
    expect(vp.getZoom()).toBe(z);
  });
});

/** The dock's own numbers at a 1440x900 window: the docked column costs 416 css px, so the box loses
 *  that width from one side and its centre travels half of it. */
const WIN = { w: 1440, h: 900 } as const;
const DOCK = 416;

describe('the one resize at a dock settle moves the world by exactly the centre travel', () => {
  it('at a LEFT dock: the box centre travels +dock/2, and so does every world point', () => {
    const box: Box = { left: 0, top: 0, width: WIN.w, height: WIN.h };
    const r = makeRenderer(box);
    r.viewport.fitToMap(24, 24);
    const before = r.viewport.cellToScreen(3, 7);
    box.left = DOCK; box.width = WIN.w - DOCK;
    r.resize(box.width, box.height);
    const after = r.viewport.cellToScreen(3, 7);
    expect(after.x - before.x).toBeCloseTo(DOCK / 2, 6);
    expect(after.y - before.y).toBeCloseTo(0, 6);
  });

  it('at a RIGHT dock: the same travel, mirrored', () => {
    const box: Box = { left: 0, top: 0, width: WIN.w, height: WIN.h };
    const r = makeRenderer(box);
    r.viewport.fitToMap(24, 24);
    const before = r.viewport.cellToScreen(3, 7);
    box.width = WIN.w - DOCK;
    r.resize(box.width, box.height);
    const after = r.viewport.cellToScreen(3, 7);
    expect(after.x - before.x).toBeCloseTo(-DOCK / 2, 6);
  });

  it('and back out: undocking returns the world to where it stood', () => {
    const box: Box = { left: 0, top: 0, width: WIN.w, height: WIN.h };
    const r = makeRenderer(box);
    r.viewport.fitToMap(24, 24);
    const before = r.viewport.cellToScreen(3, 7);
    box.left = DOCK; box.width = WIN.w - DOCK;
    r.resize(box.width, box.height);
    box.left = 0; box.width = WIN.w;
    r.resize(box.width, box.height);
    const after = r.viewport.cellToScreen(3, 7);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

describe('a window resize while docked re-frames the map into the new box', () => {
  it('keeps the world centred in the strip the dock leaves', () => {
    const box: Box = { left: 0, top: 0, width: WIN.w, height: WIN.h };
    const r = makeRenderer(box);
    r.viewport.fitToMap(24, 24);
    box.left = DOCK; box.width = WIN.w - DOCK;
    r.resize(box.width, box.height);
    const centre = r.viewport.screenToWorld(DOCK + (WIN.w - DOCK) / 2, WIN.h / 2);
    // The window narrows to 1100 and the dock's strip narrows with the fit, to 318.
    box.left = 318; box.width = 1100 - 318;
    r.resize(box.width, box.height);
    const after = r.viewport.screenToWorld(318 + (1100 - 318) / 2, WIN.h / 2);
    expect(after.x).toBeCloseTo(centre.x, 6);
    expect(after.y).toBeCloseTo(centre.y, 6);
  });
});

describe('a page-zoom step keeps its physical framing through the resize that reports it', () => {
  it('holds the same world point under the same physical screen position', () => {
    const r = makeRenderer({ left: 0, top: 0, width: 1000, height: 800 });
    r.viewport.fitToMap(40, 30);
    const worldBefore = r.viewport.screenToWorld(400, 300);
    const physicalBefore = r.viewport.getZoom();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.25 });
    r.resize(1000 / 1.25, 800 / 1.25);
    const worldAfter = r.viewport.screenToWorld(400 / 1.25, 300 / 1.25);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    expect(r.viewport.getZoom() * 1.25).toBeCloseTo(physicalBefore, 10);
  });
});
