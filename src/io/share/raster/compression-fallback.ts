import { deflateSync, gzipSync, zlibSync, Inflate, Unzlib, Gunzip } from 'fflate';
import { crc32 } from '../../../core/base/crc32';
import { concatBytes } from '../../../core/base/bytes';
import { ImportError } from '../../save/import-error';
import type { StreamFormat } from './zlib';

export function compress(bytes: Uint8Array, format: StreamFormat): Uint8Array {
  if (format === 'deflate-raw') return deflateSync(bytes);
  if (format === 'deflate') return zlibSync(bytes);
  return gzipSync(bytes);
}

export function decompress(bytes: Uint8Array, format: StreamFormat, cap: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const receive = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > cap) throw new ImportError('corrupt', 'Decompressed data exceeds safety limit.');
    chunks.push(chunk);
  };
  const stream = format === 'deflate-raw' ? new Inflate(receive)
    : format === 'deflate' ? new Unzlib(receive) : new Gunzip(receive);
  if (stream instanceof Gunzip) stream.onmember = () => { throw new ImportError('corrupt', 'Trailing compressed data.'); };
  if (bytes.length === 0) stream.push(bytes, true);
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    stream.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  const output = concatBytes(chunks, total);
  if (format === 'gzip') {
    const end = bytes.length;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (end < 8 || view.getUint32(end - 8, true) !== crc32(output) || view.getUint32(end - 4, true) !== (output.length >>> 0)) {
      throw new ImportError('corrupt', 'Invalid compressed checksum.');
    }
  }
  if (format === 'deflate') {
    let a = 1, b = 0;
    for (let offset = 0; offset < output.length; offset += 5552) {
      for (const byte of output.subarray(offset, offset + 5552)) { a += byte; b += a; }
      a %= 65521; b %= 65521;
    }
    const expected = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset).getUint32(bytes.length - 4) : -1;
    if (((b << 16 | a) >>> 0) !== expected) throw new ImportError('corrupt', 'Invalid compressed checksum.');
  }
  return output;
}
