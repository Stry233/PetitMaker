// src/__tests__/io/share/codec-measure.test.ts — measures PetitGlyph v2 payload sizes across the
// real-map-shaped corpus (corpus.ts) and asserts exact round-trips. The printed table locks the
// glyph density-tier capacity ladder (T0-T5, see io/share/glyph/geometry.ts TIERS):
// the adversarial "entropy bomb" case is the hard gate — it must fit the densest
// tier T5 (20424 B; measured 8795 B lands in T4), else the ladder / coder needs redesign.
import { describe, it, expect } from 'vitest';
import { corpusCases } from './corpus';
import { encodeMapPayload, decodeMapPayload } from '../../../io/share/codec/payload';
import { canonicalize, canonicalBytes } from '../../../io/share/canonical';

const META = { appVersion: 'measure', saveVersion: 3 };
describe('codec corpus: exactness + measured sizes', () => {
  it('every corpus map round-trips exactly; print the size table', async () => {
    const L: string[] = ['', '== PAYLOAD SIZES (bytes) — locks tier ladder =='];
    for (const { name, state } of await corpusCases()) {
      const bytes = await encodeMapPayload(state, null, META);
      const dec = await decodeMapPayload(bytes);
      expect(canonicalBytes(dec.canonical), name).toEqual(canonicalBytes(canonicalize(state)));
      L.push(`  ${name.padEnd(24)} ${String(bytes.length).padStart(7)}`);
    }
    console.error(L.join('\n'));
  }, 600000);
});
