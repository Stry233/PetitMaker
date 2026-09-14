// The one path that reads a provider-returned image URL. Providers serve output from CDN hosts
// unrelated to their API origin, so the host is free; scheme, image signature, and body size are not.
import { scrub } from './errors';
import { bytesToDataUrl, MAX_IMAGE_BYTES, sniffImageType } from './image-response';
import { StylizeError } from './types';

export { MAX_IMAGE_BYTES } from './image-response';

function isHttps(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch { return false; }
}

async function readBounded(res: Response): Promise<Uint8Array> {
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new StylizeError('bad_response');
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new StylizeError('bad_response');
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Fetch a provider image URL and re-encode it as a data URL. Throws `StylizeError`. */
export async function fetchProviderImage(url: string, signal?: AbortSignal): Promise<string> {
  if (!isHttps(url)) throw new StylizeError('bad_response');

  let res: Response;
  try {
    res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  } catch (err) {
    throw new StylizeError('network', scrub(String(err instanceof Error ? err.message : err)));
  }
  if (!res.ok) throw new StylizeError('bad_response');

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new StylizeError('bad_response');
  }

  const bytes = await readBounded(res);
  const mime = sniffImageType(bytes);
  if (!mime) throw new StylizeError('bad_response');

  return bytesToDataUrl(bytes, mime);
}
