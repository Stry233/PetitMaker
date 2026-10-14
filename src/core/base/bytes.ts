/** Joins byte chunks into one array. `total` is their summed length when the caller has counted it. */
export function concatBytes(parts: readonly Uint8Array[], total?: number): Uint8Array<ArrayBuffer> {
  let length = total;
  if (length === undefined) { length = 0; for (const part of parts) length += part.byteLength; }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}
