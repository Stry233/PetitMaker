// @vitest-environment jsdom
/** The stylize deck leans toward the pointer measured in the same layout px as its box. */
import { afterEach, describe, expect, it } from 'vitest';
import { setViewportSpace, toClientPoint } from '../../../../../../platform/device/viewport-space';
import { pointerLean } from '../../../../../../ui/chrome/modals/export/stylize/Hero';

afterEach(() => setViewportSpace(null));

const BOX = { x: 100, y: 50, width: 200, height: 100 };
/** A mouse event at layout point (x, y), carrying the client coordinates a browser would report. */
const at = (x: number, y: number) => {
  const c = toClientPoint(x, y);
  return { clientX: c.x, clientY: c.y, nativeEvent: new MouseEvent('mousemove', { clientX: c.x, clientY: c.y }) };
};

describe('the stylize deck lean', () => {
  it('reads the box centre as rest and its edges as full lean under a scaled viewport', () => {
    setViewportSpace({ width: 800, height: 400, left: 10, top: 20, rotated: false, scale: 2 });
    expect(pointerLean(at(200, 100), BOX)).toEqual({ x: 0, y: 0 });
    expect(pointerLean(at(300, 150), BOX)).toEqual({ x: 1, y: 1 });
  });

  it('follows the pointer across a rotated viewport', () => {
    setViewportSpace({ width: 824, height: 380, left: 5, top: 20, rotated: true, scale: 1 });
    expect(pointerLean(at(200, 100), BOX)).toEqual({ x: 0, y: 0 });
    expect(pointerLean(at(100, 100), BOX)).toEqual({ x: -1, y: 0 });
  });
});
