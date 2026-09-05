// src/io/share/raster/png-raster.ts
// Minimal, dependency-free PNG raster codec for the pixel-payload carrier: decode an 8-bit
// truecolor PNG (color type 2 = RGB or 6 = RGBA, no interlace) to straight RGBA, and encode
// straight RGBA back to a type-6 PNG. Enough to read/write the pixels a browser canvas emits.
// IDAT uses zlib (DEFLATE with a zlib header) per the PNG spec → CompressionMethod.Deflate.
import { ShareError, type ShareLimits, DEFAULT_LIMITS } from '../errors';
import { CompressionMethod, deflate, inflate } from './zlib';
import { readChunks, buildChunk, PNG_SIGNATURE } from './png-chunks';

export interface RasterImage { width: number; height: number; data: Uint8Array } // RGBA, length w*h*4

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode an 8-bit, non-interlaced, RGB/RGBA PNG to straight RGBA. Throws ShareError on an
 *  unsupported format (the importer treats that as "no pixel payload", not a crash). */
export async function decodePng(bytes: Uint8Array, limits: ShareLimits = DEFAULT_LIMITS): Promise<RasterImage> {
  const chunks = readChunks(bytes); // validates signature + per-chunk CRC
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) throw new ShareError('decode-failed', 'PNG missing IHDR.');
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = dv.getUint32(0, false), height = dv.getUint32(4, false);
  const bitDepth = ihdr.data[8]!, colorType = ihdr.data[9]!, interlace = ihdr.data[12]!;
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new ShareError('decode-failed', `Unsupported PNG format (bitDepth ${bitDepth}, colorType ${colorType}, interlace ${interlace}).`);
  }
  if (width <= 0 || height <= 0 || width * height > (limits.maxRasterPixels ?? 64 * 1024 * 1024)) {
    throw new ShareError('corrupt', 'PNG dimensions out of range.');
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;

  let idatLen = 0;
  for (const c of chunks) if (c.type === 'IDAT') idatLen += c.data.length;
  const idat = new Uint8Array(idatLen);
  { let o = 0; for (const c of chunks) if (c.type === 'IDAT') { idat.set(c.data, o); o += c.data.length; } }

  const rawMax = height * (1 + stride) + 64;
  const raw = await inflate(idat, CompressionMethod.Deflate, { maxBytes: Math.min(rawMax, limits.maxCanonicalBytes), maxRatio: limits.maxInflateRatio });
  if (raw.length < height * (1 + stride)) throw new ShareError('corrupt', 'PNG raster underflow.');

  // Unfilter scanlines in place into `cur`.
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]!;
    for (let i = 0; i < stride; i++) cur[i] = raw[p + i]!;
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = cur[i]!;
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new ShareError('corrupt', `Unknown PNG filter ${filter}.`);
      cur[i] = v;
    }
    const row = y * width * 4;
    if (bpp === 4) {
      out.set(cur, row);
    } else {
      for (let x = 0; x < width; x++) {
        out[row + x * 4] = cur[x * 3]!; out[row + x * 4 + 1] = cur[x * 3 + 1]!; out[row + x * 4 + 2] = cur[x * 3 + 2]!; out[row + x * 4 + 3] = 255;
      }
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

/** Encode straight RGBA to an 8-bit type-6 PNG (filter 0 per scanline; deflate handles the
 *  compression). Lossless: the exact RGBA samples round-trip through decodePng. */
export async function encodePng(img: RasterImage): Promise<Uint8Array> {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0; // filter: None
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  const idat = await deflate(raw, CompressionMethod.Deflate);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false); dv.setUint32(4, height, false);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array(PNG_SIGNATURE), buildChunk('IHDR', ihdr), buildChunk('IDAT', idat), buildChunk('IEND', new Uint8Array(0))];
  let total = 0; for (const part of parts) total += part.length;
  const outBytes = new Uint8Array(total); let o = 0;
  for (const part of parts) { outBytes.set(part, o); o += part.length; }
  return outBytes;
}
