import { describe, it, expect } from 'vitest';
import { gfMul, gfInv } from '../../../../io/share/glyph/gf256';

describe('gf256', () => {
  it('mul identity + inverse for all nonzero', () => {
    expect(gfMul(0, 5)).toBe(0);
    expect(gfMul(1, 7)).toBe(7);
    for (let a = 1; a < 256; a++) expect(gfMul(a, gfInv(a))).toBe(1);
  });
  it('associative', () => {
    expect(gfMul(gfMul(3, 7), 11)).toBe(gfMul(3, gfMul(7, 11)));
  });
});
