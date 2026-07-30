// adaptive binary range coder (LZMA-style, integer-only, exact
// encoder/decoder mirror). All state fits JS doubles exactly (low ≤ 2^33; everything else 32-bit).
const PROB_BITS = 11;
const PROB_ONE = 1 << PROB_BITS;
const MOVE_BITS = 5;
const TOP = 1 << 24;

export class BitModel { p = PROB_ONE >> 1; }

export class RangeEncoder {
  private low = 0;
  private range = 0xffffffff;
  private cache = 0;
  private cacheSize = 1; // first shiftLow emits the initial zero cache byte (decoder skips it)
  private out: number[] = [];

  encodeBit(m: BitModel, bit: 0 | 1): void {
    const bound = (this.range >>> PROB_BITS) * m.p;
    if (bit === 0) { this.range = bound; m.p += (PROB_ONE - m.p) >> MOVE_BITS; }
    else { this.low += bound; this.range -= bound; m.p -= m.p >> MOVE_BITS; }
    while (this.range < TOP) { this.shiftLow(); this.range = (this.range * 256) >>> 0; }
  }
  encodeDirect(value: number, nbits: number): void {
    for (let i = nbits - 1; i >= 0; i--) {
      this.range = Math.floor(this.range / 2);
      if ((value >>> i) & 1) this.low += this.range;
      while (this.range < TOP) { this.shiftLow(); this.range = (this.range * 256) >>> 0; }
    }
  }
  finish(): Uint8Array { for (let i = 0; i < 5; i++) this.shiftLow(); return Uint8Array.from(this.out); }
  private shiftLow(): void {
    const carry = Math.floor(this.low / 0x100000000);
    if (this.low % 0x100000000 < 0xff000000 || carry === 1) {
      let temp = this.cache;
      do { this.out.push((temp + carry) & 0xff); temp = 0xff; } while (--this.cacheSize !== 0);
      this.cache = Math.floor((this.low % 0x100000000) / 0x1000000);
    }
    this.cacheSize++;
    this.low = (this.low % 0x1000000) * 256;
  }
}

export class RangeDecoder {
  private range = 0xffffffff;
  private code = 0;
  private pos = 0;
  constructor(private buf: Uint8Array) {
    for (let i = 0; i < 5; i++) this.code = this.code * 256 + (this.buf[this.pos++] ?? 0);
  }
  decodeBit(m: BitModel): 0 | 1 {
    const bound = (this.range >>> PROB_BITS) * m.p;
    let bit: 0 | 1;
    if (this.code < bound) { bit = 0; this.range = bound; m.p += (PROB_ONE - m.p) >> MOVE_BITS; }
    else { bit = 1; this.code -= bound; this.range -= bound; m.p -= m.p >> MOVE_BITS; }
    while (this.range < TOP) { this.code = this.code * 256 + (this.buf[this.pos++] ?? 0); this.range = (this.range * 256) >>> 0; }
    return bit;
  }
  decodeDirect(nbits: number): number {
    let v = 0;
    for (let i = 0; i < nbits; i++) {
      this.range = Math.floor(this.range / 2);
      let b = 0;
      if (this.code >= this.range) { this.code -= this.range; b = 1; }
      v = v * 2 + b;
      while (this.range < TOP) { this.code = this.code * 256 + (this.buf[this.pos++] ?? 0); this.range = (this.range * 256) >>> 0; }
    }
    return v;
  }
}

/** Binary tree of adaptive models for an n-bit symbol (context per prefix). */
export class TreeModel {
  models: BitModel[];
  constructor(public bits: number) { this.models = Array.from({ length: (1 << bits) - 1 }, () => new BitModel()); }
}
export function encodeTree(enc: RangeEncoder, t: TreeModel, value: number): void {
  let node = 1;
  for (let i = t.bits - 1; i >= 0; i--) { const bit = ((value >>> i) & 1) as 0 | 1; enc.encodeBit(t.models[node - 1]!, bit); node = node * 2 + bit; }
}
export function decodeTree(dec: RangeDecoder, t: TreeModel): number {
  let node = 1;
  for (let i = 0; i < t.bits; i++) node = node * 2 + dec.decodeBit(t.models[node - 1]!);
  return node - (1 << t.bits);
}

/** Adaptive unsigned integer: Elias-gamma exponent with per-position adaptive continuation bits,
 *  then the mantissa as direct bits. Handles 0 ≤ v < 2^31. */
export class UintModel { len = Array.from({ length: 32 }, () => new BitModel()); }
export function encodeUint(enc: RangeEncoder, m: UintModel, v: number): void {
  const n = 32 - Math.clz32(v + 1); // bit length of v+1 (≥1)
  for (let i = 0; i < n - 1; i++) enc.encodeBit(m.len[i]!, 1);
  enc.encodeBit(m.len[n - 1]!, 0);
  if (n > 1) enc.encodeDirect((v + 1) & ((1 << (n - 1)) - 1), n - 1);
}
export function decodeUint(dec: RangeDecoder, m: UintModel): number {
  let n = 1;
  while (dec.decodeBit(m.len[n - 1]!) === 1) n++;
  const mant = n > 1 ? dec.decodeDirect(n - 1) : 0;
  return (1 << (n - 1)) + mant - 1;
}

export function zigzag(n: number): number { return n >= 0 ? n * 2 : -n * 2 - 1; }
export function unzigzag(z: number): number { return z % 2 === 0 ? z / 2 : -(z + 1) / 2; }
