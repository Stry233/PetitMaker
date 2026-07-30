import { describe, it, expect } from 'vitest';
import { BitModel, RangeEncoder, RangeDecoder, TreeModel, encodeTree, decodeTree, UintModel, encodeUint, decodeUint, zigzag, unzigzag } from '../../../../io/share/codec/bitio';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; }; }

describe('range coder', () => {
  it('round-trips 20k mixed adaptive bits exactly', () => {
    const r = rng(7);
    const bits: (0 | 1)[] = Array.from({ length: 20000 }, () => (r() < 0.83 ? 0 : 1)) as (0 | 1)[];
    const enc = new RangeEncoder(); const m = new BitModel();
    for (const b of bits) enc.encodeBit(m, b);
    const buf = enc.finish();
    const dec = new RangeDecoder(buf); const m2 = new BitModel();
    for (const b of bits) expect(dec.decodeBit(m2)).toBe(b);
  });
  it('compresses skewed input (1000 zeros ≤ 40 bytes)', () => {
    const enc = new RangeEncoder(); const m = new BitModel();
    for (let i = 0; i < 1000; i++) enc.encodeBit(m, 0);
    expect(enc.finish().length).toBeLessThanOrEqual(40);
  });
  it('direct bits + tree + uint + zigzag round-trip', () => {
    const enc = new RangeEncoder(); const t = new TreeModel(3); const u = new UintModel();
    enc.encodeDirect(0xabc, 12);
    for (const v of [0, 1, 5, 7]) encodeTree(enc, t, v);
    for (const v of [0, 1, 127, 100000]) encodeUint(enc, u, v);
    const dec = new RangeDecoder(enc.finish()); const t2 = new TreeModel(3); const u2 = new UintModel();
    expect(dec.decodeDirect(12)).toBe(0xabc);
    for (const v of [0, 1, 5, 7]) expect(decodeTree(dec, t2)).toBe(v);
    for (const v of [0, 1, 127, 100000]) expect(decodeUint(dec, u2)).toBe(v);
    expect(unzigzag(zigzag(-5))).toBe(-5); expect(unzigzag(zigzag(9))).toBe(9);
  });
});
