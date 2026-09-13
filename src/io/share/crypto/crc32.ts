// src/io/share/crypto/crc32.ts
// Standard PNG/zlib CRC-32 (polynomial 0xEDB88320), table-driven.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Pass a previous result to continue the checksum across chunks. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let c = previous ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
