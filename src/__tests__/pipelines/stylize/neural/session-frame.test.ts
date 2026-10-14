// @vitest-environment jsdom
/** The frame a neural take hands the model: the band letterboxed into the frame the model was trained on. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const framed = vi.hoisted(() => [] as [number, number][]);
vi.mock('../../../../pipelines/stylize/neural/tensor', () => ({
  modelSize: (width: number, height: number) => { framed.push([width, height]); return { width: 8, height: 8 }; },
  rgbaToTensor: () => new Float32Array(192),
  tensorToRgba: () => new Uint8ClampedArray(256),
}));

beforeEach(() => {
  framed.length = 0;
  vi.stubGlobal('Worker', class { terminate = vi.fn(); postMessage() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({}, {
    get: (_target, key) => key === 'getImageData' ? () => ({ data: new Uint8ClampedArray(256) }) : () => {},
  }) as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function band(width: number, height: number): HTMLCanvasElement {
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  return source;
}

it('is the training frame: longest edge 1536 in the nearest of the five gateway aspects', async () => {
  const { stylizeNeural } = await import('../../../../pipelines/stylize/neural/session');
  const bands: [number, number][] = [[2400, 1800], [2000, 2000], [1800, 2400], [1350, 2400], [2400, 1350]];
  for (const [w, h] of bands) void stylizeNeural(band(w, h), 'watercolor', '#ffffff').catch(() => {});
  expect(framed).toEqual([[1536, 1152], [1536, 1536], [1152, 1536], [864, 1536], [1536, 864]]);
});
