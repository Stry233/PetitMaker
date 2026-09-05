/** Constraint-length-seven convolutional code, with a rate-three-quarters puncturing mask. */
const MASK = [1, 1, 1, 0, 0, 1];
const parity = (value: number): number => { value ^= value >>> 4; value ^= value >>> 2; value ^= value >>> 1; return value & 1; };
const OUT = Array.from({ length: 128 }, (_, reg) => [parity(reg & 0o171), parity(reg & 0o133)]);

export function codedBits(byteLength: number): number {
  const length = (byteLength * 8 + 6) * 2;
  return Math.floor(length / MASK.length) * 4 + MASK.slice(0, length % MASK.length).reduce((a, b) => a + b, 0);
}

export function convolutionEncode(bytes: Uint8Array): number[] {
  let state = 0;
  const out: number[] = [];
  for (let i = 0; i < bytes.length * 8 + 6; i++) {
    const bit = i < bytes.length * 8 ? (bytes[i >>> 3]! >>> (7 - (i & 7))) & 1 : 0;
    const reg = (state << 1) | bit;
    for (let j = 0; j < 2; j++) if (MASK[(i * 2 + j) % MASK.length]) out.push(OUT[reg]![j]!);
    state = reg & 63;
  }
  return out;
}

/** Positive likelihood favors one, negative favors zero; punctured bits contribute no cost. */
export function convolutionDecode(likelihood: Float32Array, byteLength: number): Uint8Array {
  const count = byteLength * 8 + 6;
  const decisions = new Uint8Array(count * 64);
  let costs = new Float64Array(64).fill(1e12);
  let next = new Float64Array(64);
  costs[0] = 0;
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const a = MASK[(i * 2) % MASK.length] ? likelihood[offset++]! : 0;
    const b = MASK[(i * 2 + 1) % MASK.length] ? likelihood[offset++]! : 0;
    for (let state = 0; state < 64; state++) {
      const prev = state >>> 1;
      const first = costs[prev]! - OUT[state]![0]! * a - OUT[state]![1]! * b;
      const second = costs[prev | 32]! - OUT[state | 64]![0]! * a - OUT[state | 64]![1]! * b;
      const high = second < first;
      next[state] = high ? second : first;
      decisions[i * 64 + state] = high ? 32 : 0;
    }
    [costs, next] = [next, costs];
  }
  let state = 0;
  const bytes = new Uint8Array(byteLength);
  for (let i = count - 1; i >= 0; i--) {
    if (i < byteLength * 8) bytes[i >>> 3]! |= (state & 1) << (7 - (i & 7));
    state = (state >>> 1) | decisions[i * 64 + state]!;
  }
  return bytes;
}
