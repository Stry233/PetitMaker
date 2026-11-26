import { base64ToBytes, bytesToBase64 } from '../../core/base/bytes';

/** A base64 `data:` URL split into its two parts. */
interface DataUrlParts { mime: string; base64: string }

/** A base64 data URL as its media type and payload, or null for any other string. */
export function parseDataUrl(url: string): DataUrlParts | null {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(url);
  return match ? { mime: match[1]!, base64: match[2]! } : null;
}

/** A PNG, JPEG or WebP data URL with a nonempty, well-formed base64 payload, or null. This checks
 *  the grammar only; the bytes may still not be an image. */
export function parseRasterDataUrl(url: string): DataUrlParts | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  return match ? { mime: match[1]!, base64: match[2]! } : null;
}

/** Base64 data URL for `bytes` of media type `mime`. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** `blob` as a base64 data URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Decode a `data:` URL (a canvas capture, `data:image/png;base64,…`) into a Blob synchronously,
 *  without a fetch round trip. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  if (/;base64/i.test(head)) return new Blob([base64ToBytes(body)], { type: mime });
  return new Blob([decodeURIComponent(body)], { type: mime });
}
