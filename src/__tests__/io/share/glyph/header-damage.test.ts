import { describe, expect, it } from 'vitest';
import { buildHeaderBytes, encodeGlyph } from '../../../../io/share/glyph/encode';
import { decodeGlyph } from '../../../../io/share/glyph/decode';
import { PRODUCT_HEADER_LEVELS } from '../../../../io/share/glyph/palette';
import { HEADER_NSYM, HEADER_SYMBOL_BITS, HEADER_VERSION, headerModuleAt } from '../../../../io/share/glyph/geometry';
import { rsEncode } from '../../../../io/share/glyph/rs';
import { bytesToSymbols } from '../../../../io/share/glyph/bitpack';

const MB = 10;

function payload(n: number): Uint8Array {
  const a = new Uint8Array(n);
  let s = 7;
  for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; a[i] = s >>> 24; }
  return a;
}

/** Repaint the protected header with a valid Reed-Solomon codeword for the given eight bytes. */
function withHeader(rgba: Uint8Array, width: number, header: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba);
  const symbols = bytesToSymbols(rsEncode(header, HEADER_NSYM), HEADER_SYMBOL_BITS);
  for (let k = 0; k < symbols.length; k++) {
    const { col, row } = headerModuleAt(k);
    const c = PRODUCT_HEADER_LEVELS[symbols[k]!]!;
    for (let y = row * MB + 1; y < (row + 1) * MB - 1; y++) for (let x = col * MB + 1; x < (col + 1) * MB - 1; x++) {
      const i = (y * width + x) * 4;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
    }
  }
  return out;
}

describe('PetitGlyph header damage', () => {
  const data = payload(900);
  const glyph = encodeGlyph(data, MB)!;
  const header = buildHeaderBytes(HEADER_VERSION, glyph.profile.id, data);

  it('repainting the same header still decodes', () => {
    const same = withHeader(glyph.rgba, glyph.width, header);
    expect(decodeGlyph(same, glyph.width, glyph.height)).toEqual(data);
  });

  it.each([0, 3, 8, 12, 16, 21, 24, 30, 32, 41, 50, 63])('a header with bit %s flipped never returns a different payload, and a damaged CRC returns none', (bit) => {
    const damaged = header.slice();
    damaged[bit >> 3]! ^= 1 << (bit & 7);
    // The header itself is consistent, so only the CRC, length, version and profile checks can refuse it.
    const decoded = decodeGlyph(withHeader(glyph.rgba, glyph.width, damaged), glyph.width, glyph.height);
    expect(decoded === null || decoded.every((v, i) => v === data[i]) && decoded.length === data.length).toBe(true);
    if (bit >= 32) expect(decoded).toBeNull();
  });
});
