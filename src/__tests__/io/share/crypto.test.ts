import { describe, it, expect } from 'vitest';
import { crc32 } from '../../../io/share/crypto/crc32';
import { sha256, bytesToHex, hexToBytes } from '../../../io/share/crypto/sha256';

const enc = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
  it('matches the PNG/zlib CRC-32 of "IEND"', () => {
    expect(crc32(enc('IEND')) >>> 0).toBe(0xae426082);
  });
  it('is deterministic and order-sensitive', () => {
    expect(crc32(enc('abc'))).toBe(crc32(enc('abc')));
    expect(crc32(enc('abc'))).not.toBe(crc32(enc('acb')));
  });
});

describe('sha256', () => {
  it('matches the known vector for "abc"', async () => {
    const h = await sha256(enc('abc'));
    expect(bytesToHex(h)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(h.length).toBe(32);
  });
  it('hex round-trips', () => {
    const b = new Uint8Array([0, 1, 254, 255]);
    expect(hexToBytes(bytesToHex(b))).toEqual(b);
  });
});
