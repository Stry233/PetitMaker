// The versioned gzip envelope of a stored record (the autosave, the planet library): a record past
// `COMPRESS_RECORD_AT` characters is gzipped under the envelope prefix, a shorter one stays plain JSON.
import { gzipSync, Gunzip } from 'fflate';
import { crc32 } from '../../core/base/crc32';
import { ImportError } from '../save/import-error';

const PREFIX = 'petit-autosave:1:';
export const COMPRESS_RECORD_AT = 256 * 1024;
const MAX_RESTORE_BYTES = 128 * 1024 * 1024;

export function fitsRecordRestoreLimit(json: string): boolean {
  return json.length <= MAX_RESTORE_BYTES / 3 || new TextEncoder().encode(json).length <= MAX_RESTORE_BYTES;
}

export function packRecordBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return PREFIX + btoa(binary);
}

export function encodeRecord(json: string): string {
  if (json.length < COMPRESS_RECORD_AT) return json;
  return packRecordBytes(gzipSync(new TextEncoder().encode(json), { level: 1 }));
}

/** Legacy plain JSON remains readable; bounded streaming inflation rejects oversized records. A
 *  damaged or oversized envelope throws `ImportError('corrupt')`. */
export function decodeRecord(record: string): string {
  if (!record.startsWith(PREFIX)) return record;
  try {
    return inflateRecord(record.slice(PREFIX.length));
  } catch (err) {
    throw err instanceof ImportError ? err : new ImportError('corrupt', `Stored record: ${err instanceof Error ? err.message : 'unreadable'}`);
  }
}

function inflateRecord(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (bytes.length < 18) throw new ImportError('corrupt', 'Invalid autosave compression');
  const trailer = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedSize = trailer.getUint32(bytes.length - 4, true);
  if (expectedSize > MAX_RESTORE_BYTES) throw new ImportError('corrupt', 'Autosave exceeds restore limit');
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  let checksum = 0;
  const unzip = new Gunzip((chunk, final) => {
    total += chunk.length;
    if (total > MAX_RESTORE_BYTES) throw new ImportError('corrupt', 'Autosave exceeds restore limit');
    checksum = crc32(chunk, checksum);
    chunks.push(decoder.decode(chunk, { stream: !final }));
  });
  unzip.onmember = () => { throw new ImportError('corrupt', 'Trailing autosave compression data'); };
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  }
  if (total !== expectedSize || checksum !== trailer.getUint32(bytes.length - 8, true)) throw new ImportError('corrupt', 'Invalid autosave checksum');
  return chunks.join('');
}
