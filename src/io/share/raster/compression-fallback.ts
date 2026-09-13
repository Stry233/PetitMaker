import { deflateSync, gzipSync, zlibSync, Inflate, Unzlib, Gunzip } from 'fflate';
import { crc32 } from '../crypto/crc32';
import { ShareError } from '../errors';
import { CompressionMethod } from './zlib';

export function compress(bytes: Uint8Array, method: CompressionMethod): Uint8Array {
  if (method === CompressionMethod.DeflateRaw) return deflateSync(bytes);
  if (method === CompressionMethod.Deflate) return zlibSync(bytes);
  return gzipSync(bytes);
}

export function decompress(bytes: Uint8Array, method: CompressionMethod, cap: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const join = (parts: Uint8Array[], length: number) => {
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  };
  const receive = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > cap) throw new ShareError('corrupt', 'Decompressed data exceeds safety limit.');
    chunks.push(chunk);
  };
  const stream = method === CompressionMethod.DeflateRaw ? new Inflate(receive)
    : method === CompressionMethod.Deflate ? new Unzlib(receive) : new Gunzip(receive);
  if (stream instanceof Gunzip) stream.onmember = () => { throw new ShareError('corrupt', 'Trailing compressed data.'); };
  if (bytes.length === 0) stream.push(bytes, true);
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    stream.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  const output = join(chunks, total);
  if (method === CompressionMethod.Gzip) {
    const end = bytes.length;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (end < 8 || view.getUint32(end - 8, true) !== crc32(output) || view.getUint32(end - 4, true) !== (output.length >>> 0)) {
      throw new ShareError('corrupt', 'Invalid compressed checksum.');
    }
  }
  if (method === CompressionMethod.Deflate) {
    let a = 1, b = 0;
    for (let offset = 0; offset < output.length; offset += 5552) {
      for (const byte of output.subarray(offset, offset + 5552)) { a += byte; b += a; }
      a %= 65521; b %= 65521;
    }
    const expected = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(bytes.length - 4) : -1;
    if (((b << 16 | a) >>> 0) !== expected) throw new ShareError('corrupt', 'Invalid compressed checksum.');
  }
  return output;
}
