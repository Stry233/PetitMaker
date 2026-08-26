/**
 * THE 2D PROJECTION READS WHERE ITS CANVAS STANDS AT USE, from the canvas's own box.
 *
 * The box moves without resizing: the dock slide carries the map plane by transform and settles it
 * into an inset, and only the size changes reach a ResizeObserver — the settle itself moves the box
 * back with no further event. An origin captured at the last resize therefore describes where the
 * canvas stood mid-slide, and every pointer→cell answer after the settle lands offset by exactly
 * that leftover (half the dock's width, indefinitely). So the origin is a READING, not a record:
 * the renderer answers screen↔world against the container's rect as it is NOW, the same way the 3D
 * projection reads its canvas's rect per ray.
 */
import './_pixi-env';
import { describe, it, expect, afterEach } from 'vitest';
import { MapRenderer } from '../../canvas/map2d/map-renderer';
import { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../core/model/types';

const WIN = { w: 1440, h: 900 } as const;
const DOCK = 416;

const renderers: MapRenderer[] = [];

interface Box { left: number; top: number; width: number; height: number }

/** A renderer whose container reports a mutable client box, the way a live element does. */
function makeRenderer(box: Box) {
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
});

describe('the screen↔world conversion follows the box at use', () => {
  it('a box that moves with no resize still answers for where it stands now', () => {
    const box: Box = { left: 0, top: 0, width: WIN.w, height: WIN.h };
    const r = makeRenderer(box);
    r.viewport.fitToMap(24, 24);
    const before = r.viewport.cellToScreen(3, 7);
    const cellUnder = r.viewport.screenToMacro(before.x + before.scale / 2, before.y + before.scale / 2);
    box.left = 208;
    box.top = 33;
    const after = r.viewport.cellToScreen(3, 7);
    expect(after.x - before.x).toBeCloseTo(208, 6);
    expect(after.y - before.y).toBeCloseTo(33, 6);
    expect(r.viewport.screenToMacro(after.x + after.scale / 2, after.y + after.scale / 2)).toEqual(cellUnder);
  });

  it('a full dock cycle whose settle moves the box back leaves no leftover offset', () => {
    const box: Box = { left: 0, top: 0, width: WIN.w, height: WIN.h };
    const r = makeRenderer(box);
    r.viewport.fitToMap(24, 24);
    const rest = r.viewport.cellToScreen(3, 7);

    // Dock settle: the box narrows and stands past the dock's column.
    box.left = DOCK;
    box.width = WIN.w - DOCK;
    r.resize(box.width, box.height);

    // Undock slide start: the box grows back to the full window while the plane still carries the
    // slide transform, so the rect the resize is measured at stands half a dock along.
    box.left = DOCK / 2;
    box.width = WIN.w;
    r.resize(box.width, box.height);

    // Settle: the transform comes off. The size is unchanged, so nothing resizes again.
    box.left = 0;

    const after = r.viewport.cellToScreen(3, 7);
    expect(after.x).toBeCloseTo(rest.x, 6);
    expect(after.y).toBeCloseTo(rest.y, 6);
    const inv = r.viewport.screenToMacro(after.x + after.scale / 2, after.y + after.scale / 2);
    expect(inv).toEqual({ x: 3, y: 7 });
  });

  it('the inverse and the forward agree at the live box through a second cycle', () => {
    const box: Box = { left: 0, top: 0, width: WIN.w, height: WIN.h };
    const r = makeRenderer(box);
    r.viewport.fitToMap(24, 24);
    for (const side of [DOCK, DOCK] as const) {
      box.left = side; box.width = WIN.w - side;
      r.resize(box.width, box.height);
      box.left = side / 2; box.width = WIN.w;
      r.resize(box.width, box.height);
      box.left = 0;
    }
    for (const [cx, cy] of [[0, 0], [5, 5], [23, 23]] as const) {
      const at = r.viewport.cellToScreen(cx, cy);
      expect(r.viewport.screenToMacro(at.x + at.scale / 2, at.y + at.scale / 2)).toEqual({ x: cx, y: cy });
    }
  });
});
