import { describe, it, expect } from 'vitest';
import { isPng, readChunks, buildChunk } from '../../../../io/share/raster/png-chunks';
import { encodePng, decodePng } from '../../../../io/share/raster/png-raster';
import { DEFAULT_LIMITS } from '../../../../io/share/errors';

// Minimal valid-enough PNG: signature + IHDR(13) + IEND. Enough for chunk framing.
function tinyPng(): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  return new Uint8Array([...sig, ...buildChunk('IHDR', new Uint8Array(13)), ...buildChunk('IEND', new Uint8Array(0))]);
}

describe('PNG chunks and raster codec', () => {
  it('recognizes the PNG signature', () => {
    expect(isPng(tinyPng())).toBe(true);
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
  });
  it('reads chunks and verifies CRC', () => {
    expect(readChunks(tinyPng()).map((c) => c.type)).toEqual(['IHDR', 'IEND']);
  });
  it('detects a CRC corruption', () => {
    const png = tinyPng(); png[png.length - 5]! ^= 0xff;
    expect(() => readChunks(png)).toThrow();
  });
  it('encode → decode PNG round-trip losslessly preserves RGBA pixels', async () => {
    const w = 120, h = 80;
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 3 + 7) & 0xff;
    const original = { width: w, height: h, data };
    const png = await encodePng(original);
    expect(isPng(png)).toBe(true);
    const decoded = await decodePng(png);
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    expect(decoded.data).toEqual(data);
  });
  it('rejects unsupported PNG formats (depth, interlace, color type)', async () => {
    // Build a PNG with unsupported color type (grayscale = 0)
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, 10, false); dv.setUint32(4, 10, false);
    ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // colorType=0
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    const png = new Uint8Array([...sig, ...buildChunk('IHDR', ihdr), ...buildChunk('IEND', new Uint8Array(0))]);
    await expect(decodePng(png)).rejects.toThrow(/Unsupported PNG format/);
  });

  it('enforces the caller pixel limit before allocating the raster', async () => {
    const png = await encodePng({ width: 4, height: 4, data: new Uint8Array(64) });
    await expect(decodePng(png, { ...DEFAULT_LIMITS, maxRasterPixels: 15 })).rejects.toThrow('PNG dimensions out of range');
    expect((await decodePng(png, { ...DEFAULT_LIMITS, maxRasterPixels: 16 })).data.length).toBe(64);
  });

  it('retains the default 64-megapixel ceiling', async () => {
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, 8192); view.setUint32(4, 8193);
    ihdr[8] = 8; ihdr[9] = 6;
    const png = new Uint8Array([...tinyPng().subarray(0, 8), ...buildChunk('IHDR', ihdr), ...buildChunk('IEND', new Uint8Array(0))]);
    await expect(decodePng(png)).rejects.toThrow('PNG dimensions out of range');
  });
});
