// The one path that reads a provider-returned image URL. Providers serve output from CDN hosts
// unrelated to their API origin, so the host is free; scheme, image signature, and body size are not.
import { scrub } from './errors';
import { bytesToDataUrl } from './image-response';
import { StylizeError } from './types';

/** Largest image body read from a provider URL. */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** Media type read from the leading bytes; CDN `content-type` headers are not consulted. */
function sniffImageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  const ascii = (i: number, text: string) => [...text].every((ch, k) => at(i + k) === ch.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

function isHttps(url: string): boolean {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

/** Fetch a provider image URL and re-encode it as a data URL. Throws `StylizeError`. */
export async function fetchProviderImage(url: string, signal?: AbortSignal): Promise<string> {
  if (!isHttps(url)) throw new StylizeError('bad_response');

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    throw new StylizeError('network', scrub(String(err instanceof Error ? err.message : err)));
  }
  if (!res.ok) throw new StylizeError('bad_response');

  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new StylizeError('bad_response');

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new StylizeError('bad_response');
  const mime = sniffImageType(bytes);
  if (!mime) throw new StylizeError('bad_response');

  return bytesToDataUrl(bytes, mime);
}
