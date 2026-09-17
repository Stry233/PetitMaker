// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-ignore - node builtins are untyped in this tree
import { inflateSync } from 'node:zlib';
import { PngStream } from '../../../io/export/png-stream';

/** A deterministic RGBA image: gradients and a hard edge, so every filter has something to do. */
function picture(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    px[i] = (x * 37) & 255; px[i + 1] = (y * 53) & 255; px[i + 2] = x > w / 2 ? 200 : 20; px[i + 3] = y % 3 === 0 ? 255 : 128;
  }
  return px;
}

interface Chunk { type: string; data: Uint8Array }
function chunks(png: Uint8Array): Chunk[] {
  expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const out: Chunk[] = [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  while (o < png.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...png.slice(o + 4, o + 8));
    const data = png.slice(o + 8, o + 8 + len);
    expect(view.getUint32(o + 8 + len)).toBe(crc32(png.slice(o + 4, o + 8 + len)));
    out.push({ type, data });
    o += 12 + len;
  }
  return out;
}

/** The reference CRC the chunks must carry. */
function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (~c) >>> 0;
}

/** Undo the per-row filter the encoder chose, as any PNG reader does. */
function unfilter(raw: Uint8Array, w: number, h: number): Uint8Array {
  const bpp = 4, stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = y > 0 && i >= bpp ? out[(y - 1) * stride + i - bpp]! : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error(`filter ${f}`);
      out[y * stride + i] = (row[i]! + pred) & 255;
    }
  }
  return out;
}

async function decode(blob: Blob, w: number, h: number): Promise<Uint8Array> {
  const png = new Uint8Array(await blob.arrayBuffer());
  const list = chunks(png);
  expect(list[0]!.type).toBe('IHDR');
  const ihdr = new DataView(list[0]!.data.buffer, list[0]!.data.byteOffset);
  expect([ihdr.getUint32(0), ihdr.getUint32(4), list[0]!.data[8], list[0]!.data[9], list[0]!.data[12]]).toEqual([w, h, 8, 6, 0]);
  expect(list[list.length - 1]!.type).toBe('IEND');
  const idat = list.filter((c) => c.type === 'IDAT');
  expect(idat.length).toBeGreaterThan(0);
  const zipped = new Uint8Array(idat.reduce((n, c) => n + c.data.length, 0));
  let o = 0;
  for (const c of idat) { zipped.set(c.data, o); o += c.data.length; }
  return unfilter(new Uint8Array(inflateSync(zipped)), w, h);
}

describe('the streaming PNG encoder', () => {
  it('writes the picture it was fed in bands, byte for byte, in a valid PNG', async () => {
    const w = 37, h = 23;
    const px = picture(w, h);
    const png = new PngStream(w, h);
    let y = 0;
    for (const rows of [5, 1, 9, 8]) { png.addRows(px.subarray(y * w * 4, (y + rows) * w * 4), rows); y += rows; }
    expect(y).toBe(h);
    const blob = png.finish();
    expect(blob.type).toBe('image/png');
    expect(Array.from(await decode(blob, w, h))).toEqual(Array.from(px));
  });

  it('refuses to finish short of the height it announced', () => {
    const png = new PngStream(4, 4);
    png.addRows(new Uint8Array(4 * 4 * 2), 2);
    expect(() => png.finish()).toThrow();
  });

  it('encodes the same bytes whether the rows arrive in one band or many', async () => {
    const w = 16, h = 12;
    const px = picture(w, h);
    const whole = new PngStream(w, h); whole.addRows(px, h);
    const parts = new PngStream(w, h); parts.addRows(px.subarray(0, w * 4 * 7), 7); parts.addRows(px.subarray(w * 4 * 7), 5);
    expect(Array.from(await decode(whole.finish(), w, h))).toEqual(Array.from(await decode(parts.finish(), w, h)));
  });
});
