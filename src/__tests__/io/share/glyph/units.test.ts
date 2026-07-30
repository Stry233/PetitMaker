import { describe, it, expect } from 'vitest';
import { interleaveBlocks, deinterleave } from '../../../../io/share/glyph/interleave';
import { bytesToSymbols, symbolsToBytes } from '../../../../io/share/glyph/bitpack';

describe('interleave', () => {
  it('round-trips column-major', () => {
    const blocks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])];
    const s = interleaveBlocks(blocks);
    expect(Array.from(s)).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
    expect(deinterleave(s, 3, 3).map((b) => Array.from(b))).toEqual(blocks.map((b) => Array.from(b)));
  });
});

describe('bitpack', () => {
  it('6-bit symbols round-trip back to bytes', () => {
    const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a]);
    const syms = bytesToSymbols(bytes, 6);
    expect(symbolsToBytes(syms, 6, bytes.length)).toEqual(bytes);
    for (const s of syms) expect(s).toBeLessThan(64);
  });
});
