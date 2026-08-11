import { describe, it, expect } from 'vitest';
import { encodeMapPayload, decodeMapPayload } from '../../../../io/share/codec/payload';
import { canonicalize, canonicalBytes } from '../../../../io/share/canonical';
import { createBlankGridState } from '../../../../io/share/codec/blank-grid';
import { makeState } from '../../../rules/_helpers';
import { MAP_TEMPLATES } from '../../../../config/maps';
import { TerrainType } from '../../../../core/model/types';
import type { GridState } from '../../../../core/model/types';

// `makeState` builds a synthetic template (id 'test') that is not one of the built-in maps in
// config/maps, so getMapTemplate('test') would silently fall back to the default map (hexia) —
// wrong dimensions. Register the synthetic template so getMapTemplate resolves it exactly, the
// same way a real map id would. Mutates the shared registry, so each call re-registers the
// current size (tests run sequentially within this file).
function registerSynthetic(state: GridState): GridState {
  MAP_TEMPLATES[state.template.id] = state.template;
  return state;
}

const META = { appVersion: '1.0-test', saveVersion: 3 };
describe('payload frame', () => {
  it('empty map round-trips tiny (< 150 B) and hash-exact', async () => {
    const state = createBlankGridState('hexia');
    const bytes = await encodeMapPayload(state, null, META);
    expect(bytes.length).toBeLessThan(150);
    const dec = await decodeMapPayload(bytes);
    expect(canonicalBytes(dec.canonical)).toEqual(canonicalBytes(canonicalize(state)));
  });
  it('edited map round-trips exactly', async () => {
    const state = registerSynthetic(makeState(24, 24));
    for (let y = 3; y < 9; y++) for (let x = 3; x < 12; x++) state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
    const bytes = await encodeMapPayload(state, null, { ...META, title: 'test map' });
    const dec = await decodeMapPayload(bytes);
    expect(canonicalBytes(dec.canonical)).toEqual(canonicalBytes(canonicalize(state)));
    expect(dec.provenance.title).toBe('test map');
  });
  it('tampered bytes throw corrupt (hash gate)', async () => {
    const state = registerSynthetic(makeState(16, 16));
    // A wholly-blank map codes to a residual that is almost entirely the range coder's trailing
    // flush margin (never read back), so the map carries some shape and the edit lands inside the
    // coded run rather than in that margin.
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
    const bytes = await encodeMapPayload(state, null, META);
    bytes[Math.floor(bytes.length * 0.9)]! ^= 0x40;
    await expect(decodeMapPayload(bytes)).rejects.toMatchObject({ code: expect.stringMatching(/corrupt|decode-failed/) });
  });
  it('a model shape this build does not have reads as future, not corrupt', async () => {
    // The shape table is append-only, so an index past its end was written by a newer build. The
    // import toast routes 'corrupt' to "try a better picture" and 'future-version' to "update" —
    // only the second is honest about a code that is perfectly intact.
    const state = registerSynthetic(makeState(8, 8));
    const bytes = await encodeMapPayload(state, null, META);
    bytes[3] = 250;
    await expect(decodeMapPayload(bytes)).rejects.toMatchObject({ code: 'future-version' });
  });
  it('future frame version throws future-version', async () => {
    const state = registerSynthetic(makeState(8, 8));
    const bytes = await encodeMapPayload(state, null, META);
    bytes[2] = 99;
    await expect(decodeMapPayload(bytes)).rejects.toMatchObject({ code: 'future-version' });
  });
});
