import { describe, expect, it } from 'vitest';
import { codedBits, convolutionDecode, convolutionEncode } from '../../../../io/share/glyph/convolution';

const payload = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 73 + 29) & 255);

describe('soft convolutional transport', () => {
  it.each([1, 2, 3, 31, 223, 4096])('terminates and recovers a %i-byte stream', (length) => {
    const bytes = payload(length);
    const bits = convolutionEncode(bytes);
    expect(bits.length).toBe(codedBits(length));
    expect(convolutionDecode(Float32Array.from(bits, (bit) => bit ? 10 : -10), length)).toEqual(bytes);
  });

  it('uses confidence to recover wrong hard decisions', () => {
    const bytes = payload(256);
    const bits = convolutionEncode(bytes);
    const samples = Float32Array.from(bits, (bit, i) => (bit ? 1 : -1) * (i % 7 === 0 ? -0.1 : 10));
    expect(Array.from(samples).filter((value, i) => (value > 0 ? 1 : 0) !== bits[i]).length).toBeGreaterThan(300);
    expect(convolutionDecode(samples, bytes.length)).toEqual(bytes);
  });
});
