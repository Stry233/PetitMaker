/**
 * A dependency-free PNG codec for tests and internal scripts: the app reads pictures through the
 * browser's decoder (`io/import/raster.ts`) and writes them through `io/export/png-stream.ts`, so this
 * reads and writes 8-bit RGB or RGBA without interlace, enough for fixtures and the pixels a canvas
 * emits, and opens a share image's bytes through the same raster entry the import takes.
 */
import { crc32 } from '../../core/base/crc32';
import { concatBytes } from '../../core/base/bytes';
import { DEFAULT_LIMITS, type ShareLimits } from '../../io/share/errors';
import { ImportError } from '../../io/save/import-error';
import { CompressionMethod, deflate, inflate } from '../../io/share/raster/zlib';
import { buildChunk, ihdrBytes, PNG_SIGNATURE } from '../../io/share/raster/png-chunks';
import { importFromRaster, type ImportResult } from '../../io/share';

export interface RasterImage { width: number; height: number; data: Uint8Array } // RGBA, length w*h*4

interface PngChunk { type: string; data: Uint8Array }

/** Every chunk through IEND, each CRC checked; throws `ImportError` for bytes that are not a PNG
 *  or a damaged chunk. */
export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) throw new ImportError('not-an-image', 'Not a PNG.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p, false);
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    const dataStart = p + 8;
    const crcAt = dataStart + len;
    if (crcAt + 4 > bytes.length) throw new ImportError('corrupt', 'Truncated PNG chunk.');
    const want = dv.getUint32(crcAt, false) >>> 0;
    const got = crc32(bytes.subarray(p + 4, crcAt));
    if (want !== got) throw new ImportError('corrupt', `Bad CRC in ${type} chunk.`);
    chunks.push({ type, data: new Uint8Array(bytes.subarray(dataStart, crcAt)) });
    p = crcAt + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode an 8-bit, non-interlaced, RGB/RGBA PNG to straight RGBA. Throws ImportError on an
 *  unsupported format (the importer treats that as "no pixel payload", not a crash). */
export async function decodePng(bytes: Uint8Array, limits: ShareLimits = DEFAULT_LIMITS): Promise<RasterImage> {
  const chunks = readChunks(bytes); // validates signature + per-chunk CRC
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr || ihdr.data.length < 13) throw new ImportError('decode-failed', 'PNG missing IHDR.');
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const width = dv.getUint32(0, false), height = dv.getUint32(4, false);
  const bitDepth = ihdr.data[8]!, colorType = ihdr.data[9]!, interlace = ihdr.data[12]!;
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new ImportError('decode-failed', `Unsupported PNG format (bitDepth ${bitDepth}, colorType ${colorType}, interlace ${interlace}).`);
  }
  if (width <= 0 || height <= 0 || width * height > (limits.maxRasterPixels ?? 64 * 1024 * 1024)) {
    throw new ImportError('corrupt', 'PNG dimensions out of range.');
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;

  let idatLen = 0;
  for (const c of chunks) if (c.type === 'IDAT') idatLen += c.data.length;
  const idat = new Uint8Array(idatLen);
  { let o = 0; for (const c of chunks) if (c.type === 'IDAT') { idat.set(c.data, o); o += c.data.length; } }

  const rawMax = height * (1 + stride) + 64;
  const raw = await inflate(idat, CompressionMethod.Deflate, { maxBytes: Math.min(rawMax, limits.maxCanonicalBytes), maxRatio: limits.maxInflateRatio });
  if (raw.length < height * (1 + stride)) throw new ImportError('corrupt', 'PNG raster underflow.');

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
      else if (filter !== 0) throw new ImportError('corrupt', `Unknown PNG filter ${filter}.`);
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
  const parts = [new Uint8Array(PNG_SIGNATURE), buildChunk('IHDR', ihdrBytes(width, height)), buildChunk('IDAT', idat), buildChunk('IEND', new Uint8Array(0))];
  return concatBytes(parts);
}

/** The map a share image's PNG bytes carry, decoded here in place of the browser's decoder. */
export async function importFromBytes(input: ArrayBuffer | Uint8Array, limits: ShareLimits = DEFAULT_LIMITS): Promise<ImportResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let img: RasterImage;
  try {
    img = await decodePng(bytes, limits);
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e };
    throw e;
  }
  return importFromRaster(img.data, img.width, img.height);
}
