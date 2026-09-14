// src/io/share/raster/zlib.ts
// Zlib/DEFLATE compression and decompression via the browser's Compression Streams API.
import { ShareError } from '../errors';

/** Append-only. The manifest records the exact method so the algorithm is swappable. */
export enum CompressionMethod { Store = 0, DeflateRaw = 1, Deflate = 2, Gzip = 3 }

function streamFormat(m: CompressionMethod): 'deflate' | 'deflate-raw' | 'gzip' {
  switch (m) {
    case CompressionMethod.Deflate: return 'deflate';
    case CompressionMethod.DeflateRaw: return 'deflate-raw';
    case CompressionMethod.Gzip: return 'gzip';
    default: throw new ShareError('decode-failed', `Unknown compression method ${m}.`);
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function deflate(bytes: Uint8Array, method: CompressionMethod): Promise<Uint8Array> {
  if (method === CompressionMethod.Store) return bytes.slice();
  const format = streamFormat(method);
  let cs: CompressionStream;
  try { cs = new CompressionStream(format); }
  catch { return (await import('./compression-fallback')).compress(bytes, method); }
  const w = cs.writable.getWriter();
  // Capture the write+close chain so a later cancel can't surface as an unhandled rejection.
  const pump = w.write(bytes as Uint8Array<ArrayBuffer>).then(() => w.close()).catch(() => {});
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) { chunks.push(value); total += value.length; } }
  await pump;
  return concat(chunks, total);
}

export async function inflate(
  bytes: Uint8Array,
  method: CompressionMethod,
  opts: { maxBytes: number; maxRatio: number },
): Promise<Uint8Array> {
  if (method === CompressionMethod.Store) {
    if (bytes.length > opts.maxBytes) throw new ShareError('corrupt', 'Payload exceeds size limit.');
    return bytes.slice();
  }
  // Abort once output would exceed the smaller of the absolute cap and the ratio guard.
  const ratioCap = Math.max(64, bytes.length * opts.maxRatio);
  const cap = Math.min(opts.maxBytes, ratioCap);
  const format = streamFormat(method);
  let ds: DecompressionStream;
  try { ds = new DecompressionStream(format); }
  catch { return (await import('./compression-fallback')).decompress(bytes, method, cap); }
  const w = ds.writable.getWriter();
  const pump = w.write(bytes as Uint8Array<ArrayBuffer>).then(() => w.close()).catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        await pump;
        throw new ShareError('corrupt', 'Decompressed data exceeds safety limit.');
      }
      chunks.push(value);
    }
  }
  await pump;
  return concat(chunks, total);
}
