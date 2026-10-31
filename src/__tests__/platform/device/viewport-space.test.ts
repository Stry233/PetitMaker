// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { clientPoint, setViewportSpace, subscribeViewportSize, toClientPoint, toLayoutRect, viewportSize, viewportSizeSnapshot } from '../../../platform/device/viewport-space';

afterEach(() => setViewportSpace(null));
describe('editor presentation coordinates', () => {
  it('keeps the ordinary browser viewport and pointer coordinates unchanged', () => {
    expect(viewportSize()).toEqual({ width: innerWidth, height: innerHeight });
    expect(clientPoint(new MouseEvent('mousemove', { clientX: 31, clientY: 54 }))).toEqual({ x: 31, y: 54 });
  });
  it('measures input and popover bounds from an inset page', () => {
    setViewportSpace({ width: 380, height: 790, left: 5, top: 34 });
    expect(viewportSize()).toEqual({ width: 380, height: 790 });
    expect(clientPoint(new MouseEvent('mousemove', { clientX: 15, clientY: 120 }))).toEqual({ x: 10, y: 86 });
    expect(toClientPoint(10, 86)).toEqual({ x: 15, y: 120 });
    expect(toLayoutRect({ x: 15, left: 15, y: 120, top: 120, right: 55, bottom: 200, width: 40, height: 80 }))
      .toEqual({ x: 10, left: 10, y: 86, top: 86, right: 50, bottom: 166, width: 40, height: 80 });
  });
  it('converts React events once and preserves cached layout samples', () => {
    setViewportSpace({ width: 390, height: 810, left: 0, top: 34 });
    expect(clientPoint({ clientX: 40, clientY: 100, nativeEvent: new MouseEvent('mousemove') })).toEqual({ x: 40, y: 66 });
    expect(clientPoint({ clientX: 40, clientY: 66 })).toEqual({ x: 40, y: 66 });
  });
  it('round-trips input under keyboard fitting and safe-area offsets', () => {
    setViewportSpace({ width: 500, height: 390, left: 80, top: 12 });
    for (const [x, y] of [[0, 0], [500, 390], [123, 245]]) {
      const client = toClientPoint(x!, y!);
      const layout = clientPoint(new MouseEvent('mousemove', { clientX: client.x, clientY: client.y }));
      expect(layout.x).toBeCloseTo(x!); expect(layout.y).toBeCloseTo(y!);
    }
  });
});

describe('the shared window size', () => {
  const resizeTo = (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  };
  afterEach(() => resizeTo(1024, 768));

  it('keeps one snapshot until an axis moves, and tells every reader once per resize', () => {
    resizeTo(1180, 820);
    const told = [0, 0];
    const offs = told.map((_, i) => subscribeViewportSize(() => { told[i]!++; }));
    const first = viewportSizeSnapshot();
    expect(viewportSizeSnapshot()).toBe(first);
    window.dispatchEvent(new Event('resize'));
    expect(told).toEqual([0, 0]);
    resizeTo(820, 1180);
    window.dispatchEvent(new Event('resize'));
    window.visualViewport?.dispatchEvent(new Event('resize'));
    expect(told).toEqual([1, 1]);
    expect(viewportSizeSnapshot()).toEqual({ width: 820, height: 1180 });
    for (const off of offs) off();
    resizeTo(700, 500);
    window.dispatchEvent(new Event('resize'));
    expect(told).toEqual([1, 1]);
  });

  it('tells its readers when an inset page changes its box', () => {
    let told = 0;
    const off = subscribeViewportSize(() => { told++; });
    setViewportSpace({ width: 380, height: 790, left: 5, top: 34 });
    expect(told).toBe(1);
    expect(viewportSizeSnapshot()).toEqual({ width: 380, height: 790 });
    off();
  });
});
