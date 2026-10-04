import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanPreview } from '../../../io/planet-scan/preview';
import { ScanPreviewPainter } from '../../../ui/chrome/modals/planet/scan-preview-painter';
import { seconds } from '../../../ui/design/motion';

/** A 2D context that records the images drawn and the alpha of each painted unit. */
function fakeContext() {
  const drawn: { w: number; h: number; dw: number; dh: number; alpha: number }[] = [];
  const ctx = {
    globalAlpha: 1,
    images: [] as ImageData[],
    drawn,
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) as ImageData,
    putImageData(image: ImageData) { ctx.images.push(image); },
    drawImage(source: { width: number; height: number }, _x: number, _y: number, dw: number, dh: number) { drawn.push({ w: source.width, h: source.height, dw, dh, alpha: ctx.globalAlpha }); },
  };
  return new Proxy(ctx, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => {}), set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; return true; } });
}

const last = <T,>(list: T[]): T => list[list.length - 1]!;

let contexts: ReturnType<typeof fakeContext>[] = [];
beforeEach(() => {
  contexts = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const self = this as HTMLCanvasElement & { __ctx?: ReturnType<typeof fakeContext> };
    if (!self.__ctx) { self.__ctx = fakeContext(); contexts.push(self.__ctx); }
    return self.__ctx as unknown as CanvasRenderingContext2D;
  } as never);
});
afterEach(() => vi.restoreAllMocks());

const coverage = (cols: number, classes: number[], view = { x: 0, y: 0, w: 32, h: 16 }): ScanPreview => {
  const packed = new Uint8Array(Math.ceil(cols / 4));
  classes.forEach((v, i) => { packed[i >> 2]! |= v << ((i & 3) * 2); });
  return { kind: 'coverage', x: 0, y: 0, unitW: 16, unitH: 16, cols, rows: 1, classes: packed, view };
};

const target = () => {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: 320 });
  Object.defineProperty(canvas, 'clientHeight', { value: 200 });
  return canvas;
};

describe('the import picture', () => {
  it('shows the latest state at once without motion', () => {
    const painter = new ScanPreviewPainter();
    painter.ingest(coverage(2, [1, 3]), 0, false);
    expect(painter.draw(target(), 0, false)).toBe(false);
    const units = last(contexts.flatMap((c) => c.images)).data;
    expect([units[3], units[7]]).toEqual([255, 255]);
  });

  it('fades newly read units in over the reveal and keeps moving until they arrive', () => {
    const painter = new ScanPreviewPainter();
    const canvas = target();
    painter.ingest(coverage(2, [1, 0]), 0, true);
    painter.draw(canvas, 0, true);
    const reveal = seconds('scan.preview.reveal') * 1000;
    painter.ingest(coverage(2, [1, 3]), 1000, true);
    expect(painter.draw(canvas, 1000 + reveal / 2, true)).toBe(true);
    const half = last(contexts.flatMap((c) => c.images)).data;
    // The first unit was read before and stays whole; the second is half way in.
    expect(half[3]).toBe(255);
    expect(half[7]).toBeGreaterThan(0);
    expect(half[7]).toBeLessThan(255);
    painter.draw(canvas, 1000 + reveal + 5000, true);
    expect(painter.draw(canvas, 1000 + reveal + 5016, true)).toBe(false);
  });

  it('paints the coverage in the colours the recording showed', () => {
    const painter = new ScanPreviewPainter();
    const rgb = new Uint8Array([10, 20, 30, 0, 0, 0]);
    painter.ingest({ ...coverage(2, [1, 0]), rgb }, 0, false);
    painter.draw(target(), 0, false);
    const units = last(contexts.flatMap((c) => c.images)).data;
    expect([...units.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect(units[7]).toBe(0);
  });

  it('keeps the recording whole under the cells once pass 2 reads them', () => {
    const painter = new ScanPreviewPainter();
    const canvas = target();
    painter.ingest(coverage(2, [1, 3]), 0, false);
    painter.ingest({ ...coverage(2, [3, 3]), kind: 'ground', chunk: 16, view: undefined }, 0, false);
    const ctx = canvas.getContext('2d') as unknown as ReturnType<typeof fakeContext>;
    ctx.drawn.length = 0;
    painter.draw(canvas, 0, false);
    expect(ctx.drawn.map((d) => d.alpha)).toEqual([1, 1]);
  });
});
