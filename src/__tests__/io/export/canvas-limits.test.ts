/**
 * What this device's 2D canvas can allocate, probed once.
 *
 * Desktop Chrome allows 16384 px per side and 16384² pixels of area. WebKit's area ceiling is about
 * a sixteenth of that, so an Original export composed against the desktop constant comes back blank
 * on an iPhone. The ladder descends from the desktop values, so a device that confirms them keeps
 * every pixel it had.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { __resetCanvasLimits, deviceCanvasLimits } from '../../../io/export/canvas-limits';
import { CANVAS_LIMITS } from '../../../io/export/sizing';

/** A device whose canvases hold their far corner only where `allows` says, and the sizes it was asked for. */
function device(allows: (w: number, h: number) => boolean): Array<[number, number]> {
  const asked: Array<[number, number]> = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = {
        width: 0, height: 0,
        getContext: () => {
          asked.push([canvas.width, canvas.height]);
          const alpha = allows(canvas.width, canvas.height) ? 255 : 0;
          return { fillStyle: '', fillRect() {}, getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, alpha]) }) };
        },
      };
      return canvas;
    },
  });
  return asked;
}

afterEach(() => { vi.unstubAllGlobals(); __resetCanvasLimits(); });

describe('measuring the device', () => {
  it('asks for the largest candidate first and keeps the first one confirmed', () => {
    const asked = device((w, h) => w <= 8192 && h <= 8192);
    expect(deviceCanvasLimits()).toEqual({ maxDim: 8192, maxArea: 8192 * 8192 });
    expect(asked.slice(0, 2)).toEqual([[16384, 1], [8192, 1]]);
  });

  it('reads a WebKit-shaped device: a long side it allows, an area it refuses', () => {
    device((w, h) => w * h <= 4096 * 4096);
    expect(deviceCanvasLimits()).toEqual({ maxDim: 16384, maxArea: 4096 * 4096 });
  });

  it('keeps the conservative constants when nothing can be confirmed', () => {
    device(() => false);
    expect(deviceCanvasLimits()).toEqual(CANVAS_LIMITS);
  });

  it('takes the smallest rung where one ladder confirms nothing and the other does', () => {
    device((_w, h) => h === 1);
    expect(deviceCanvasLimits()).toEqual({ maxDim: 16384, maxArea: 4096 * 4096 });
  });
});

describe('deviceCanvasLimits', () => {
  it('keeps the conservative constants where no document exists', () => {
    expect(deviceCanvasLimits()).toEqual(CANVAS_LIMITS);
  });

  it('probes once per session', () => {
    const asked = device(() => true);
    expect(deviceCanvasLimits()).toBe(deviceCanvasLimits());
    expect(asked).toHaveLength(2);
  });
});
