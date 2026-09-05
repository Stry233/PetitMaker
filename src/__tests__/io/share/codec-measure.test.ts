// Measures current payload and transport selection across the shared map corpus.
import { describe, it, expect } from 'vitest';
import { corpusCases } from './corpus';
import { encodeMapPayload, decodeMapPayload } from '../../../io/share/codec/payload';
import { canonicalize, canonicalBytes } from '../../../io/share/canonical';
import { choosePlan } from '../../../io/share/glyph/profiles';

const META = { appVersion: 'measure', saveVersion: 3 };
describe('codec corpus: exactness + measured sizes', () => {
  it('every corpus map round-trips exactly; print the size table', async () => {
    const L: string[] = ['', '== CURRENT PAYLOAD AND GLYPH PROFILE =='];
    for (const { name, state } of await corpusCases()) {
      const bytes = await encodeMapPayload(state, null, META);
      const dec = await decodeMapPayload(bytes);
      expect(canonicalBytes(dec.canonical), name).toEqual(canonicalBytes(canonicalize(state)));
      const plan = choosePlan(bytes.length);
      expect(plan, name).not.toBeNull();
      if (!plan) continue;
      const active = `${(plan.symbolCount / plan.moduleCount * 100).toFixed(1)}%`;
      L.push(`  ${name.padEnd(24)} ${String(bytes.length).padStart(7)} B  ${plan.profile.name.padEnd(16)} ${active.padStart(6)}`);
    }
    console.error(L.join('\n'));
  }, 600000);
});
