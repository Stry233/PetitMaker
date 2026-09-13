import { gzipSync, Gunzip } from 'fflate';
import { crc32 } from './share/crypto/crc32';

const PREFIX = 'petit-autosave:1:';
export const COMPRESS_AUTOSAVE_AT = 256 * 1024;
const MAX_RESTORE_BYTES = 128 * 1024 * 1024;

export function fitsAutosaveRestoreLimit(json: string): boolean {
  return json.length <= MAX_RESTORE_BYTES / 3 || new TextEncoder().encode(json).length <= MAX_RESTORE_BYTES;
}

export function packAutosaveBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return PREFIX + btoa(binary);
}

export function encodeAutosave(json: string): string {
  if (json.length < COMPRESS_AUTOSAVE_AT) return json;
  return packAutosaveBytes(gzipSync(new TextEncoder().encode(json), { level: 1 }));
}

/** Legacy plain JSON remains readable; bounded streaming inflation rejects oversized records. */
export function decodeAutosave(record: string): string {
  if (!record.startsWith(PREFIX)) return record;
  const binary = atob(record.slice(PREFIX.length));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (bytes.length < 18) throw new Error('Invalid autosave compression');
  const trailer = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedSize = trailer.getUint32(bytes.length - 4, true);
  if (expectedSize > MAX_RESTORE_BYTES) throw new Error('Autosave exceeds restore limit');
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  let checksum = 0;
  const unzip = new Gunzip((chunk, final) => {
    total += chunk.length;
    if (total > MAX_RESTORE_BYTES) throw new Error('Autosave exceeds restore limit');
    checksum = crc32(chunk, checksum);
    chunks.push(decoder.decode(chunk, { stream: !final }));
  });
  unzip.onmember = () => { throw new Error('Trailing autosave compression data'); };
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  }
  if (total !== expectedSize || checksum !== trailer.getUint32(bytes.length - 8, true)) throw new Error('Invalid autosave checksum');
  return chunks.join('');
}

/** A large save's compression runs in a disposable same-origin worker. */
export function encodeAutosaveInWorker(json: string, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('./autosave.worker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (bytes?: Uint8Array, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else {
        try { resolve(packAutosaveBytes(bytes!)); } catch (error) { reject(error); }
      }
    };
    const abort = () => finish(undefined, new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(undefined, new Error('Autosave compression timed out')), 15_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Uint8Array>) => finish(data);
    worker.onerror = () => finish(undefined, new Error('Autosave worker failed'));
    worker.onmessageerror = () => finish(undefined, new Error('Autosave worker response failed'));
    if (signal.aborted) { abort(); return; }
    const bytes = new TextEncoder().encode(json);
    try { worker.postMessage(bytes, [bytes.buffer]); } catch (error) { finish(undefined, error); }
  });
}
