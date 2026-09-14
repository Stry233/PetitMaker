import { StylizeError } from './types';

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** Media type read from the leading bytes; CDN `content-type` headers are not consulted. */
export function sniffImageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  const ascii = (i: number, text: string) => [...text].every((ch, k) => at(i + k) === ch.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return null;
}

/** Base64 data URL for image bytes, read straight off the `ArrayBuffer` a fetch reply carries. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return `data:${mime};base64,${btoa(binary)}`;
}

/** The engine accepts raster bytes only, never a model-authored URL, document or executable image. */
export function assertRasterDataUrl(value: string): void {
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32) throw new StylizeError('bad_response');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[2]!.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new StylizeError('bad_response');
  let prefix: string;
  try { prefix = atob(match[2]!.slice(0, 32)); } catch { throw new StylizeError('bad_response'); }
  // Base64-only provider replies may omit their MIME type; the raster signature is authoritative.
  if (!sniffImageType(Uint8Array.from(prefix, (char) => char.charCodeAt(0)))) {
    throw new StylizeError('bad_response');
  }
}
