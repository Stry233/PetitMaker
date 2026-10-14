import { describe, expect, it } from 'vitest';
import { CompressionMethod, deflate, inflate } from '../../../../io/share/raster/zlib';
import { ImportError } from '../../../../io/save/import-error';

const LIMITS = { maxBytes: 1 << 20, maxRatio: 256 };

describe('zlib inflate', () => {
  it('round-trips a deflated record', async () => {
    const plain = new TextEncoder().encode('a planet record '.repeat(40));
    const packed = await deflate(plain, CompressionMethod.Deflate);
    expect(await inflate(packed, CompressionMethod.Deflate, LIMITS)).toEqual(plain);
  });

  it('refuses a damaged stream as corrupt input', async () => {
    const packed = await deflate(new TextEncoder().encode('a planet record '.repeat(40)), CompressionMethod.Deflate);
    const damaged = packed.slice();
    for (let i = 2; i < damaged.length; i += 3) damaged[i] = damaged[i]! ^ 0xa5;
    await expect(inflate(damaged, CompressionMethod.Deflate, LIMITS)).rejects.toSatisfy(
      (e: unknown) => e instanceof ImportError && e.code === 'corrupt',
    );
  });
});
