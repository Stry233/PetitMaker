// src/io/share/glyph/bitpack.ts — repack a byte stream into n-bit symbols (and back),
// MSB-first. Glyph modules carry n-bit symbols (n = tier.bits ∈ {3,4} for the data region, 2 for
// the header — see glyph/geometry.ts TIERS) while Reed–Solomon works over 8-bit bytes, so the
// codec bridges the two here. Also maps symbol-level erasures back to the bytes they touch.
export function bytesToSymbols(bytes: Uint8Array, bits: number): number[] {
  const out: number[] = [];
  let acc = 0, nbits = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i]!;
    nbits += 8;
    while (nbits >= bits) { nbits -= bits; out.push((acc >> nbits) & ((1 << bits) - 1)); }
  }
  if (nbits > 0) out.push((acc << (bits - nbits)) & ((1 << bits) - 1)); // pad final partial symbol
  return out;
}

export function symbolsToBytes(symbols: number[], bits: number, byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  let acc = 0, nbits = 0, bi = 0;
  for (let i = 0; i < symbols.length && bi < byteLen; i++) {
    acc = (acc << bits) | (symbols[i]! & ((1 << bits) - 1));
    nbits += bits;
    while (nbits >= 8 && bi < byteLen) { nbits -= 8; out[bi++] = (acc >> nbits) & 0xff; }
  }
  return out;
}

/** Bytes touched by a set of erased symbol indices (a byte is erased if any overlapping
 *  symbol is unreliable). bits = symbol width; byteLen = decoded byte length. */
export function symbolErasuresToByteErasures(symErasures: number[], bits: number, byteLen: number): number[] {
  const set = new Set<number>();
  for (const s of symErasures) {
    const startBit = s * bits;
    const endBit = startBit + bits - 1;
    for (let b = Math.floor(startBit / 8); b <= Math.floor(endBit / 8) && b < byteLen; b++) set.add(b);
  }
  return [...set].sort((a, b) => a - b);
}
