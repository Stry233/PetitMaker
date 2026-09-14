import { afterEach, expect, it, vi } from 'vitest';
import { readRasterImage } from '../../io/raster-image';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([false, true])('releases bitmap and canvas after readback succeeds or fails (%s)', async fail => {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2, height: 1, close })));
  const canvas = document.createElement('canvas');
  const pixels = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => {
      expect(close).toHaveBeenCalledOnce();
      if (fail) throw new Error('readback');
      return { data: pixels };
    },
  } as never);
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
  if (fail) await expect(readRasterImage(new Blob())).rejects.toThrow('readback');
  else expect(await readRasterImage(new Blob())).toEqual({ width: 2, height: 1, pixels: new Uint8Array(pixels.buffer) });
  expect(close).toHaveBeenCalledOnce();
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
});

it('rejects oversized images before allocating a canvas and closes the bitmap', async () => {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10000, height: 10000, close })));
  const create = vi.spyOn(document, 'createElement');
  await expect(readRasterImage(new Blob())).rejects.toThrow('pixel limit');
  expect(close).toHaveBeenCalledOnce();
  expect(create).not.toHaveBeenCalled();
});

it('uses and revokes a Blob URL when ImageBitmap is unavailable', async () => {
  vi.stubGlobal('createImageBitmap', undefined);
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL });
  vi.stubGlobal('Image', class {
    naturalWidth = 1; naturalHeight = 1;
    onload?: () => void;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  });
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(4) }) } as never);
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
  expect((await readRasterImage(new Blob())).width).toBe(1);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  expect(canvas.width).toBe(0);
});

it('rejects an oversized PNG header before requesting bitmap decoding', async () => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, 10000);
  new DataView(bytes.buffer).setUint32(20, 10000);
  const blob = { slice: () => ({ arrayBuffer: async () => bytes.buffer }) } as unknown as Blob;
  vi.stubGlobal('createImageBitmap', vi.fn());
  await expect(readRasterImage(blob)).rejects.toThrow('pixel limit');
  expect(createImageBitmap).not.toHaveBeenCalled();
});
