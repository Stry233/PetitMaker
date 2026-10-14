import { afterEach, describe, it, expect, vi } from 'vitest';
import { crc32 } from '../../../core/base/crc32';
import { sha256, bytesToHex } from '../../../core/base/sha256';

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
  afterEach(() => { vi.unstubAllGlobals(); });

  it('matches the known vector for "abc"', async () => {
    const h = await sha256(enc('abc'));
    expect(bytesToHex(h)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(h.length).toBe(32);
  });
  it('writes bytes as two lower-case hex digits each', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 254, 255]))).toBe('0001feff');
  });

  // The share code must build from a plain-http origin too, where crypto.subtle does not exist
  // (#29): the pure-JS path is the one that runs there, so it must agree with Web Crypto bit
  // for bit — across block boundaries (55/56/64 bytes bracket the padding edge) and payloads
  // the size of a real map.
  it('the pure-JS fallback matches Web Crypto on every padding edge and a large payload', async () => {
    const subtle = crypto.subtle;
    const viaSubtle = async (bytes: Uint8Array) => bytesToHex(new Uint8Array(await subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)));
    vi.stubGlobal('crypto', {});
    expect(bytesToHex(await sha256(enc('abc'))))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(bytesToHex(await sha256(new Uint8Array(0))))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    for (const n of [1, 3, 55, 56, 57, 63, 64, 65, 127, 128, 1000, 70000]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 37 + n) & 0xff;
      expect(bytesToHex(await sha256(bytes)), `n=${n}`).toBe(await viaSubtle(bytes));
    }
  });
});
