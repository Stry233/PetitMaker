// @vitest-environment jsdom
/** The map area clear of the frame's marked surfaces, and a right-hand column read level with given rows. */
import { afterEach, describe, expect, it } from 'vitest';
import { clearMapArea, mapEdgeAttr } from '../../../ui/primitives/map-edge';

const VIEWPORT = { width: 390, height: 844 };

function mark(edge: 'top' | 'bottom' | 'right', rect: { left: number; top: number; right: number; bottom: number }): void {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(mapEdgeAttr(edge))) el.setAttribute(k, v);
  const { left, top, right, bottom } = rect;
  el.getBoundingClientRect = () => ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) });
  document.body.appendChild(el);
}

afterEach(() => { document.body.innerHTML = ''; });

describe('clearMapArea', () => {
  it('keeps clear of every marked surface, and of the widest right-hand control without rows', () => {
    mark('top', { left: 190, top: 10, right: 380, bottom: 62 });
    mark('bottom', { left: 0, top: 560, right: 390, bottom: 844 });
    mark('right', { left: 240, top: 90, right: 380, bottom: 140 });
    mark('right', { left: 327, top: 300, right: 380, bottom: 345 });
    expect(clearMapArea(VIEWPORT)).toEqual({ left: 0, top: 62, right: 240, bottom: 560 });
  });

  it('counts a right-hand control only where it stands level with the rows asked about', () => {
    mark('right', { left: 240, top: 90, right: 380, bottom: 140 });
    mark('right', { left: 327, top: 300, right: 380, bottom: 345 });
    expect(clearMapArea(VIEWPORT, { top: 250, bottom: 302 }).right).toBe(327);
    expect(clearMapArea(VIEWPORT, { top: 400, bottom: 452 }).right).toBe(390);
    expect(clearMapArea(VIEWPORT, { top: 120, bottom: 172 }).right).toBe(240);
  });
});
