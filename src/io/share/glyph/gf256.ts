// src/io/share/glyph/gf256.ts — GF(2^8) arithmetic with primitive polynomial 0x11d,
// generator 2. Tables built once; used by the Reed–Solomon codec.
const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255]!;
})();

export function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : gfExp[gfLog[a]! + gfLog[b]!]!;
}
export function gfInv(a: number): number {
  if (a === 0) throw new Error('gfInv(0)');
  return gfExp[255 - gfLog[a]!]!;
}
export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('gfDiv by 0');
  return a === 0 ? 0 : gfExp[(gfLog[a]! + 255 - gfLog[b]!) % 255]!;
}
export function gfPow(a: number, n: number): number {
  return a === 0 ? 0 : gfExp[((gfLog[a]! * n) % 255 + 255) % 255]!;
}
