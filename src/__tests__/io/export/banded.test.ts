// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
// @ts-ignore - node builtins are untyped in this tree
import { inflateSync } from 'node:zlib';
import { BAND_ROWS_MAX, needsBanding, planTiles, renderBanded, type BandSurface, type BandWindow } from '../../../io/export/banded';
import { CANVAS_LIMITS } from '../../../io/export/sizing';

const WEBKIT = { maxDim: 4096, maxArea: 4096 * 4096 };

describe('deciding to band', () => {
  it('bands only a composition the device canvas cannot hold', () => {
    expect(needsBanding({ width: 10848, height: 9838 }, WEBKIT)).toBe(true);
    expect(needsBanding({ width: 10848, height: 9838 }, CANVAS_LIMITS)).toBe(false);
    expect(needsBanding({ width: 2400, height: 2200 }, WEBKIT)).toBe(false);
  });
});

describe('planning tiles', () => {
  it('cuts columns at the longest side allowed and bands at the area the columns leave', () => {
    const plan = planTiles(10848, 9838, WEBKIT);
    expect(plan.cols.map((c) => c.w)).toEqual([4096, 4096, 2656]);
    expect(plan.cols.map((c) => c.x)).toEqual([0, 4096, 8192]);
    expect(plan.rows[0]!.h).toBe(BAND_ROWS_MAX);
    expect(plan.rows.reduce((n, r) => n + r.h, 0)).toBe(9838);
    expect(plan.rows.every((r, i) => i === 0 || r.y === plan.rows[i - 1]!.y + plan.rows[i - 1]!.h)).toBe(true);
  });

  it('keeps one column where the width fits, and shortens bands to the area', () => {
    const plan = planTiles(3000, 5000, { maxDim: 16384, maxArea: 3000 * 300 });
    expect(plan.cols).toEqual([{ x: 0, w: 3000 }]);
    expect(plan.rows[0]!.h).toBe(300);
    expect(plan.rows.length).toBe(Math.ceil(5000 / 300));
  });
});

/** A surface whose pixels name the composition coordinates they stand at, so the assembled file
 *  proves every tile landed where its transform said. */
function namingSurface(): { make: (w: number, h: number) => BandSurface; windows: BandWindow[] } {
  const windows: BandWindow[] = [];
  const make = (_w: number, _h: number): BandSurface => {
    let dx = 0, dy = 0;
    const ctx = {
      setTransform: (_a: number, _b: number, _c: number, _d: number, e: number, f: number) => { dx = e; dy = f; },
      clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    } as unknown as CanvasRenderingContext2D;
    return {
      ctx,
      read: (rw, rh) => {
        const px = new Uint8ClampedArray(rw * rh * 4);
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
          const cx = x - dx, cy = y - dy; // composition coordinates of this pixel
          const i = (y * rw + x) * 4;
          px[i] = cx & 255; px[i + 1] = cy & 255; px[i + 2] = ((cx >> 8) & 15) | (((cy >> 8) & 15) << 4); px[i + 3] = 255;
        }
        return px;
      },
      destroy() {},
    };
  };
  return { make, windows };
}

function expectedPicture(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    px[i] = x & 255; px[i + 1] = y & 255; px[i + 2] = ((x >> 8) & 15) | (((y >> 8) & 15) << 4); px[i + 3] = 255;
  }
  return px;
}

async function decodeRgba(blob: Blob, w: number, h: number): Promise<Uint8Array> {
  const png = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(png.buffer);
  const idat: Uint8Array[] = [];
  for (let o = 8; o < png.length;) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...png.slice(o + 4, o + 8));
    if (type === 'IDAT') idat.push(png.slice(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const zipped = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0; for (const c of idat) { zipped.set(c, o); o += c.length; }
  const raw = new Uint8Array(inflateSync(zipped));
  const stride = w * 4, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= 4 ? out[y * stride + i - 4]! : 0, b = y > 0 ? out[(y - 1) * stride + i]! : 0, c = y > 0 && i >= 4 ? out[(y - 1) * stride + i - 4]! : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + i] = (v + p) & 255;
    }
  }
  return out;
}

describe('rendering in bands', () => {
  it('assembles columns and bands into the one picture, painting each tile in its own window', async () => {
    const { make, windows } = namingSurface();
    const w = 700, h = 450;
    const limits = { maxDim: 300, maxArea: 300 * 120 };
    const progress: number[] = [];
    const blob = await renderBanded({
      width: w, height: h, limits, surface: make,
      paint: (_ctx, window) => { windows.push(window); },
      onProgress: (f) => progress.push(f),
    });
    expect(Array.from(await decodeRgba(blob, w, h))).toEqual(Array.from(expectedPicture(w, h)));
    // Every window is a tile of the plan, and together they tile the whole picture exactly once.
    const area = windows.reduce((n, win) => n + (win.right - win.left) * (win.bottom - win.top), 0);
    expect(area).toBe(w * h);
    expect(windows.every((win) => win.right - win.left <= 300 && win.bottom - win.top <= 120)).toBe(true);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.every((f, i) => i === 0 || f >= progress[i - 1]!)).toBe(true);
  });

  it('stops at the signal between tiles and reports the cancellation', async () => {
    const { make } = namingSurface();
    const controller = new AbortController();
    const paint = vi.fn(() => { controller.abort(); });
    await expect(renderBanded({ width: 40, height: 40, limits: { maxDim: 40, maxArea: 40 * 10 }, surface: make, paint, signal: controller.signal }))
      .rejects.toHaveProperty('name', 'AbortError');
    expect(paint).toHaveBeenCalledTimes(1);
  });
});
