/**
 * What THIS device's 2D canvas can allocate, probed once.
 *
 * Desktop Chrome allows 16384 px per side and 16384² pixels of area. WebKit's area ceiling is about
 * a sixteenth of that, so an Original export composed against the desktop constant comes back blank
 * on an iPhone. The ladder descends from the desktop values, so a device that confirms them keeps
 * every pixel it had.
 */
import { describe, it, expect } from 'vitest';
import { deviceCanvasLimits, measureCanvasLimits } from '../../../io/export/canvas-limits';
import { CANVAS_LIMITS } from '../../../io/export/sizing';

describe('measureCanvasLimits', () => {
  it('asks for the largest candidate first and keeps the first one confirmed', () => {
    const asked: Array<[number, number]> = [];
    const limits = measureCanvasLimits((w, h) => { asked.push([w, h]); return w <= 8192 && h <= 8192; });
    expect(limits).toEqual({ maxDim: 8192, maxArea: 8192 * 8192 });
    expect(asked.slice(0, 2)).toEqual([[16384, 1], [8192, 1]]);
  });

  it('reads a WebKit-shaped device: a long side it allows, an area it refuses', () => {
    const limits = measureCanvasLimits((w, h) => w * h <= 4096 * 4096);
    expect(limits).toEqual({ maxDim: 16384, maxArea: 4096 * 4096 });
  });

  it('keeps the conservative constants when nothing can be confirmed', () => {
    expect(measureCanvasLimits(() => false)).toEqual(CANVAS_LIMITS);
  });

  it('takes the smallest rung where one ladder confirms nothing and the other does', () => {
    expect(measureCanvasLimits((_w, h) => h === 1)).toEqual({ maxDim: 16384, maxArea: 4096 * 4096 });
  });
});

describe('deviceCanvasLimits', () => {
  it('keeps the conservative constants where no 2D context exists (jsdom)', () => {
    expect(deviceCanvasLimits()).toEqual(CANVAS_LIMITS);
  });

  it('probes once per session', () => {
    expect(deviceCanvasLimits()).toBe(deviceCanvasLimits());
  });
});
