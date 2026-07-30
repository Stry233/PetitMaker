import { describe, it, expect } from 'vitest';
import { tokensOf, tokensToCells, parseToken, tokenOf } from '../../../../io/share/codec/grid-io';

describe('grid-io token round-trip', () => {
  const tokens = ['_', 't1:3', 't2:5', 't1:4:F12E', 't1:2::P', 't1:3:FFEE:P:B2', '_'];
  it('parse/emit is the identity on canonical tokens', () => {
    for (const tok of tokens) expect(tokenOf(parseToken(tok))).toBe(tok);
  });
  it('RLE round-trips including runs', () => {
    const rle = tokensToCells(['_', '_', '_', 't1:3', 't1:3', '_']);
    expect(rle).toBe('3*_,2*t1:3,_');
    expect(tokensOf(rle)).toEqual(['_', '_', '_', 't1:3', 't1:3', '_']);
  });
});
