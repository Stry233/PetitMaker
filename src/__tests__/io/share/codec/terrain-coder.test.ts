import { describe, it, expect } from 'vitest';
import { RangeEncoder, RangeDecoder } from '../../../../io/share/codec/bitio';
import { encodeTerrain, decodeTerrain } from '../../../../io/share/codec/terrain-coder';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; }; }
const W = 24, H = 16;
function randomTokens(seed: number): string[] {
  const r = rng(seed); const out: string[] = [];
  for (let i = 0; i < W * H; i++) {
    const p = r();
    if (p < 0.55) out.push('_');
    else if (p < 0.8) out.push(`t1:${1 + ((r() * 8) | 0)}`);
    else if (p < 0.92) out.push(`t2:${1 + ((r() * 4) | 0)}`);
    else out.push(`t1:${1 + ((r() * 3) | 0)}:F${'12'[(r() * 2) | 0]}E${'S4'[(r() * 2) | 0]}` + (r() < 0.3 ? ':P:B1' : ''));
  }
  return out;
}
function roundtrip(tokens: string[], predicted: string[]): string[] {
  const enc = new RangeEncoder();
  encodeTerrain(enc, tokens, predicted, W);
  return decodeTerrain(new RangeDecoder(enc.finish()), predicted, W);
}
describe('terrain coder', () => {
  const empty = Array.from({ length: W * H }, () => '_');
  it('round-trips random legal-ish grids vs empty predictor', () => {
    for (const seed of [1, 2, 3]) { const t = randomTokens(seed); expect(roundtrip(t, empty)).toEqual(t); }
  });
  it('round-trips vs a matching predictor at near-zero cost', () => {
    const t = randomTokens(9);
    const enc = new RangeEncoder(); encodeTerrain(enc, t, t, W);
    const buf = enc.finish();
    expect(buf.length).toBeLessThan(30); // all samePred bits, heavily skewed
    expect(decodeTerrain(new RangeDecoder(buf), t, W)).toEqual(t);
  });
  it('plateau grids compress far below raw', () => {
    const t = Array.from({ length: W * H }, (_, i) => (i % W < 12 ? 't1:3' : '_'));
    const enc = new RangeEncoder(); encodeTerrain(enc, t, empty, W);
    expect(enc.finish().length).toBeLessThan(40);
  });
});
