/** A base64 `data:` URL split into its two parts. */
export interface DataUrlParts { mime: string; base64: string }

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

/** Decode a `data:` URL (a canvas capture, `data:image/png;base64,…`) into a Blob synchronously,
 *  without a fetch round trip. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  if (/;base64/i.test(head)) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}
