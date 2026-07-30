import { describe, it, expect } from 'vitest';
import { rsEncode, rsDecode } from '../../../../io/share/glyph/rs';

const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

describe('reed-solomon', () => {
  it('clean round-trip', () => {
    const cw = rsEncode(data, 8);
    expect(cw.length).toBe(18);
    expect(Array.from(rsDecode(cw, 8)!)).toEqual(Array.from(data));
  });
  it('corrects up to nsym/2 errors', () => {
    const cw = rsEncode(data, 8);
    cw[2]! ^= 0xff; cw[5]! ^= 0x3c; cw[11]! ^= 0x80; cw[15]! ^= 0x01; // 4 errors, nsym=8
    expect(Array.from(rsDecode(cw, 8)!)).toEqual(Array.from(data));
  });
  it('corrects up to nsym erasures', () => {
    const cw = rsEncode(data, 8);
    const er = [0, 1, 4, 9, 12, 13, 16, 17];
    for (const p of er) cw[p]! = 0;
    expect(Array.from(rsDecode(cw, 8, er)!)).toEqual(Array.from(data));
  });
  it('corrects mixed erasures + errors within budget', () => {
    const cw = rsEncode(data, 8);
    const er = [1, 9, 16]; for (const p of er) cw[p]! = 0; // 3 erasures
    cw[4]! ^= 0x55; cw[12]! ^= 0xaa; // + 2 errors → 3 + 2*2 = 7 ≤ 8
    expect(Array.from(rsDecode(cw, 8, er)!)).toEqual(Array.from(data));
  });
  it('returns null when uncorrectable', () => {
    const cw = rsEncode(data, 4);
    for (let i = 0; i < cw.length; i++) cw[i]! ^= 0xaa;
    expect(rsDecode(cw, 4)).toBeNull();
  });
});
