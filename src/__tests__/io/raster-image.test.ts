/** Oversized rasters are decoded smaller rather than refused: the share code survives resizing, a 150-megapixel export does not fit in memory. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRasterImage } from '../../io/raster-image';
import { DEFAULT_LIMITS } from '../../io/share/errors';

/** A PNG whose header names the given size, carrying only what the reader looks at (jsdom's Blob has no arrayBuffer). */
function pngFile(width: number, height: number): Blob {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return { size: 24, type: 'image/png', slice: () => ({ arrayBuffer: async () => bytes.buffer }) } as unknown as Blob;
}
type BitmapCall = [Blob, ImageBitmapOptions | undefined];

function fakeCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('readRasterImage', () => {
  it('asks the decoder for a smaller bitmap when a PNG header announces more pixels than the limit', async () => {
    fakeCanvas();
    const bitmap = vi.fn(async (_file: Blob, opts?: ImageBitmapOptions) => ({ width: opts?.resizeWidth ?? 10848, height: opts?.resizeHeight ?? 13825, close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', bitmap);
    const out = await readRasterImage(pngFile(10848, 13825));
    const opts = (bitmap.mock.calls[0] as unknown as BitmapCall)[1]!;
    expect(opts.resizeQuality).toBe('high');
    expect(opts.resizeWidth! * opts.resizeHeight!).toBeLessThanOrEqual(DEFAULT_LIMITS.maxRasterPixels!);
    expect(opts.resizeWidth! / opts.resizeHeight!).toBeCloseTo(10848 / 13825, 2);
    expect(out.width).toBe(opts.resizeWidth);
  });

  it('decodes a small PNG at its native size', async () => {
    fakeCanvas();
    const bitmap = vi.fn(async () => ({ width: 640, height: 480, close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', bitmap);
    const out = await readRasterImage(pngFile(640, 480));
    expect((bitmap.mock.calls[0] as unknown as BitmapCall)[1]).toBeUndefined();
    expect([out.width, out.height]).toEqual([640, 480]);
  });

  it('scales a decoded bitmap of unknown size down onto the canvas instead of refusing it', async () => {
    fakeCanvas();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 12000, height: 12000, close: vi.fn() })));
    const out = await readRasterImage({ size: 3, type: 'image/jpeg' } as unknown as Blob);
    expect(out.width * out.height).toBeLessThanOrEqual(DEFAULT_LIMITS.maxRasterPixels!);
    expect(out.width).toBe(out.height);
  });
});
