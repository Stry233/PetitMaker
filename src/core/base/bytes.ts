/** Joins byte chunks into one array. `total` is their summed length when the caller has counted it. */
export function concatBytes(parts: readonly Uint8Array[], total?: number): Uint8Array<ArrayBuffer> {
  let length = total;
  if (length === undefined) { length = 0; for (const part of parts) length += part.byteLength; }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}

/** Characters a chunk of bytes becomes at once: a whole picture appended one character at a time
 *  grows a string per byte, and an argument list longer than this overflows some engines' stacks. */
const BASE64_CHUNK = 0x8000;

/** `bytes` in base64; `url` gives the URL-safe alphabet without padding. */
export function bytesToBase64(bytes: Uint8Array, opts: { url?: boolean } = {}): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  const text = btoa(binary);
  return opts.url ? text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : text;
}

/** The bytes of base64 `text`, read in either alphabet, padded or not. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(plain + '='.repeat((4 - (plain.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
