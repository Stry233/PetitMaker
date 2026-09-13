// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { CompressionMethod, deflate, inflate } from '../../io/share/raster/zlib';
import { compress, decompress } from '../../io/share/raster/compression-fallback';
import { crc32 } from '../../io/share/crypto/crc32';
import { decodeAutosave, encodeAutosave } from '../../io/autosave-codec';

const bytes = new TextEncoder().encode('Map terrain 星布谷地 '.repeat(5000));
const limits = { maxBytes: 1_000_000, maxRatio: 10000 };
afterEach(() => vi.unstubAllGlobals());

it.each([CompressionMethod.Deflate, CompressionMethod.DeflateRaw, CompressionMethod.Gzip])('interoperates with native compression for method %s', async method => {
  expect(decompress(await deflate(bytes, method), method, limits.maxBytes)).toEqual(bytes);
  expect(await inflate(compress(bytes, method), method, limits)).toEqual(bytes);
  vi.stubGlobal('CompressionStream', undefined);
  vi.stubGlobal('DecompressionStream', undefined);
  expect(await inflate(await deflate(bytes, method), method, limits)).toEqual(bytes);
});

it.each([CompressionMethod.Deflate, CompressionMethod.Gzip])('rejects a corrupt checksum for method %s', method => {
  const packed = compress(bytes, method);
  packed[packed.length - 1]! ^= 1;
  expect(() => decompress(packed, method, limits.maxBytes)).toThrow();
});

it('rejects concatenated gzip members like native streams and preserves output limits', async () => {
  const packed = compress(bytes, CompressionMethod.Gzip);
  const pair = new Uint8Array(packed.length * 2);
  pair.set(packed); pair.set(packed, packed.length);
  expect(() => decompress(pair, CompressionMethod.Gzip, limits.maxBytes)).toThrow();
  await expect(inflate(pair, CompressionMethod.Gzip, limits)).rejects.toThrow();
  expect(() => decompress(packed, CompressionMethod.Gzip, 100)).toThrow('safety limit');
});

it('reads old autosaves and losslessly compresses large Unicode snapshots', () => {
  const json = JSON.stringify({ cells: 'terrain'.repeat(100000), notes: '星布谷地 😀'.repeat(1000) });
  expect(decodeAutosave(json)).toBe(json);
  const packed = encodeAutosave(json);
  expect(packed.length).toBeLessThan(json.length / 10);
  expect(decodeAutosave(packed)).toBe(json);
  expect(encodeAutosave('{"small":true}')).toBe('{"small":true}');
});

it('continues CRC checks across stream chunks without changing single-buffer checksums', () => {
  const split = Math.floor(bytes.length / 3);
  expect(crc32(bytes.subarray(split), crc32(bytes.subarray(0, split)))).toBe(crc32(bytes));
});
it('rejects corrupted autosave compression checksums', () => {
  const packed = encodeAutosave('x'.repeat(300000));
  const colon = packed.lastIndexOf(':') + 1;
  const raw = Uint8Array.from(atob(packed.slice(colon)), char => char.charCodeAt(0));
  raw[raw.length - 8]! ^= 1;
  expect(() => decodeAutosave(packed.slice(0, colon) + btoa(String.fromCharCode(...raw)))).toThrow('checksum');
});
