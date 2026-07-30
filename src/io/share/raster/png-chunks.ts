// src/io/share/raster/png-chunks.ts
// Generic PNG chunk primitives for the raster codec: signature check, CRC-validated chunk
// reader, chunk builder.
import { crc32 } from '../crypto/crc32';
import { ShareError } from '../errors';

/** The 8-byte PNG file signature — the single source for both the reader (isPng) and the
 *  writer (png-raster prepends it to the chunk stream). */
export const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export interface PngChunk { type: string; data: Uint8Array }

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

function typeBytes(type: string): Uint8Array {
  return new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
}

export function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false); // length big-endian (PNG)
  out.set(typeBytes(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false); // crc over type+data
  return out;
}

export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new ShareError('not-an-image', 'Not a PNG.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p, false);
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    const dataStart = p + 8;
    const crcAt = dataStart + len;
    if (crcAt + 4 > bytes.length) throw new ShareError('corrupt', 'Truncated PNG chunk.');
    const want = dv.getUint32(crcAt, false) >>> 0;
    const got = crc32(bytes.subarray(p + 4, crcAt));
    if (want !== got) throw new ShareError('corrupt', `Bad CRC in ${type} chunk.`);
    chunks.push({ type, data: new Uint8Array(bytes.subarray(dataStart, crcAt)) });
    p = crcAt + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}
