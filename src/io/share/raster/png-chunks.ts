// The PNG primitives every writer and header reader shares: the signature, a chunk, the RGBA
// header and the size a file's header names.
import { crc32 } from '../../../core/base/crc32';
import { readBlob } from '../../import/read-blob';

/** The 8-byte PNG file signature. */
export const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

/** Bytes from the start of a PNG through its header's width and height. */
const SIZE_BYTES = 24;
/** The length of IHDR's data. */
const IHDR_LENGTH = 13;

/** One chunk: big-endian length, type, data, and the CRC over type and data. */
export function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/** IHDR's data for a `width` by `height` picture of 8-bit RGBA, not interlaced. */
export function ihdrBytes(width: number, height: number): Uint8Array {
  const out = new Uint8Array(IHDR_LENGTH);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  out[8] = 8; out[9] = 6;
  return out;
}

/** Whether `bytes` open with the PNG signature. */
function opensPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
}

/** The size `blob`'s PNG header names, or null for a blob that is not a PNG, names no size or
 *  cannot be read. */
export async function pngSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  let head: Uint8Array;
  try {
    head = new Uint8Array(await readBlob(blob.slice(0, SIZE_BYTES), 'bytes'));
  } catch {
    return null;
  }
  if (head.length < SIZE_BYTES || !opensPng(head)) return null;
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (dv.getUint32(8, false) !== IHDR_LENGTH || String.fromCharCode(...head.subarray(12, 16)) !== 'IHDR') return null;
  const width = dv.getUint32(16, false), height = dv.getUint32(20, false);
  return width && height ? { width, height } : null;
}
