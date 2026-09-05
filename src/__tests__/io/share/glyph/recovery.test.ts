import { describe, expect, it } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { BlockRecovery } from '../../../../io/share/glyph/recovery';
import { choosePlan } from '../../../../io/share/glyph/profiles';
import { rsEncode } from '../../../../io/share/glyph/rs';
import { interleaveBlocks } from '../../../../io/share/glyph/interleave';
import { bytesToSymbols } from '../../../../io/share/glyph/bitpack';
import { whiten } from '../../../../io/share/glyph/encode';
import { crc32 } from '../../../../io/share/crypto/crc32';
import { bytesToHex, sha256 } from '../../../../io/share/crypto/sha256';
import { decodePng } from '../../../../io/share/raster/png-raster';
import { decodeGlyph } from '../../../../io/share/glyph/decode';

function recoveryFixture() {
  const payload = Uint8Array.from({ length: 400 }, (_, i) => (i * 31 + 9) & 255);
  const plan = choosePlan(payload.length)!;
  const padded = new Uint8Array(plan.blocks * plan.dataBytes);
  padded.set(payload);
  const blocks = Array.from({ length: plan.blocks }, (_, b) => rsEncode(
    padded.subarray(b * plan.dataBytes, (b + 1) * plan.dataBytes), plan.parityBytes,
  ));
  const sample = (damaged: number) => {
    const copy = blocks.map((block) => block.slice());
    if (damaged >= 0) for (let i = 0; i <= plan.parityBytes / 2 + 10; i++) copy[damaged]![i]! ^= 0x5a;
    const symbols = bytesToSymbols(whiten(interleaveBlocks(copy)), plan.profile.bits);
    return { symbols, confidence: symbols.map(() => 1) };
  };
  return { payload, plan, sample };
}

describe('image recovery', () => {
  it.each([1, 8, 40])('uses the full erasure capacity for a %i-byte single-block payload', (length) => {
    const payload = Uint8Array.from({ length }, (_, i) => i * 3 + 1);
    const plan = choosePlan(length)!;
    expect(plan.blocks).toBe(1);
    const block = rsEncode(payload, plan.parityBytes);
    for (let i = 0; i < plan.parityBytes; i++) block[i]! ^= 0x5a;
    const symbols = bytesToSymbols(whiten(block), plan.profile.bits);
    const confidence = symbols.map((_, i) => i * plan.profile.bits < plan.parityBytes * 8 ? 0 : 1);
    expect(new BlockRecovery(plan, length, crc32(payload)).read(symbols, confidence)).toEqual(payload);
  });

  it('combines corrected blocks from incomplete sampling passes', () => {
    const { payload, plan, sample } = recoveryFixture();
    const recovery = new BlockRecovery(plan, payload.length, crc32(payload));
    const first = sample(0), second = sample(1);
    expect(recovery.read(first.symbols, first.confidence)).toBeNull();
    expect(new BlockRecovery(plan, payload.length, crc32(payload)).read(second.symbols, second.confidence)).toBeNull();
    expect(recovery.read(second.symbols, second.confidence)).toEqual(payload);
  });

  it('rejects corrected codewords whose complete payload fails its CRC', () => {
    const { payload, plan, sample } = recoveryFixture();
    const clean = sample(-1);
    const recovery = new BlockRecovery(plan, payload.length, crc32(payload) ^ 1);
    expect(recovery.read(clean.symbols, clean.confidence)).toBeNull();
    expect(recovery.knownSymbols().every((symbol) => symbol === -1)).toBe(true);
  });

  it('stops error-correction attempts when its shared budget is exhausted', () => {
    const { payload, plan, sample } = recoveryFixture();
    const damaged = sample(0);
    const budget = { attempts: 1 };
    const recovery = new BlockRecovery(plan, payload.length, crc32(payload));
    expect(recovery.read(damaged.symbols, damaged.confidence, budget)).toBeNull();
    expect(budget.attempts).toBe(0);
  });

  it.each([
    ['legacy-v2-author', 3724, 'f99db764e1a236fa5dbaf9a0266af88a33e7923593370037eda16d909f660067'],
    ['social-1080-double-jpeg', 3702, '684b1ccf8634a2505e3c6eceb278484e8e9773b4fca8868eaed538c221f670da'],
    ['dense-1080-jpeg75', 6879, 'b1927b60412e369fa59b32488879f6280efb9f2af12072e7143d88bd22c9acf0'],
  ])('recovers the frozen %s raster exactly', async (name, length, hash) => {
    const image = await decodePng(new Uint8Array(readFileSync(`src/__tests__/io/share/glyph/fixtures/${name}.png`)));
    const payload = decodeGlyph(image.data, image.width, image.height);
    expect(payload?.length).toBe(length);
    expect(bytesToHex(await sha256(payload!))).toBe(hash);
  }, 30_000);

  it('rejects invalid raster dimensions before scanning', () => {
    for (const [width, height] of [[-1, 1], [1.5, 2], [Infinity, 2], [0, 0], [20, 20]]) {
      expect(decodeGlyph(new Uint8Array(16), width!, height!)).toBeNull();
    }
  });
});
