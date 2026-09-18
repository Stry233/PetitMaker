import { afterEach, describe, expect, it } from 'vitest';
import { clientPoint, setViewportSpace, toClientPoint, toLayoutDelta, toLayoutPoint, toLayoutRect, viewportSize } from '../../../core/runtime/viewport-space';

afterEach(() => setViewportSpace(null));
describe('editor presentation coordinates', () => {
  it('keeps the ordinary browser viewport and pointer coordinates unchanged', () => {
    expect(viewportSize()).toEqual({ width: innerWidth, height: innerHeight });
    expect(clientPoint(new MouseEvent('mousemove', { clientX: 31, clientY: 54 }))).toEqual({ x: 31, y: 54 });
  });
  it('maps portrait input and popover bounds into the landscape editor', () => {
    setViewportSpace({ width: 824, height: 380, left: 5, top: 20, rotated: true, scale: 1 });
    expect(clientPoint(new MouseEvent('mousemove', { clientX: 15, clientY: 120 }))).toEqual({ x: 100, y: 370 });
    expect(toClientPoint(100, 370)).toEqual({ x: 15, y: 120 });
    expect(toLayoutDelta(20, 30)).toEqual({ x: 30, y: -20 });
    expect(toLayoutRect({ x: 15, left: 15, y: 120, top: 120, right: 55, bottom: 200, width: 40, height: 80 })).toEqual({ x: 100, left: 100, y: 330, top: 330, right: 180, bottom: 370, width: 80, height: 40 });
  });
  it('converts React events once and preserves cached layout samples', () => {
    setViewportSpace({ width: 844, height: 390, left: 0, top: 0, rotated: true, scale: 1 });
    expect(clientPoint({ clientX: 40, clientY: 100, nativeEvent: new MouseEvent('mousemove') })).toEqual({ x: 100, y: 350 });
    expect(clientPoint({ clientX: 100, clientY: 350 })).toEqual({ x: 100, y: 350 });
  });
  it('round-trips input under keyboard fitting and safe-area offsets', () => {
    setViewportSpace({ width: 500, height: 390, left: 80, top: 12, rotated: true, scale: 0.6 });
    for (const [x, y] of [[0, 0], [500, 390], [123, 245]]) {
      const client = toClientPoint(x!, y!);
      const layout = toLayoutPoint(client.x, client.y);
      expect(layout.x).toBeCloseTo(x!); expect(layout.y).toBeCloseTo(y!);
    }
  });
});
