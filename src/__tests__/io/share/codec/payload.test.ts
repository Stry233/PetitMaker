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

  it('an ordinary generation recipe rides as the note', async () => {
    const state = registerSynthetic(makeState(24, 24));
    state.generation = { algorithm: 'designed', mode: 'earth', corridorWidth: 1, maxElevation: 6, seed: 11, region: null };
    const dec = await decodeMapPayload(await encodeMapPayload(state, null, META));
    expect(dec.generation?.seed).toBe(11);
  });

  it('a stencil recipe never rides — the picture is binary source data, and the map already carries it (#29)', async () => {
    // JSON turns the stencil's typed arrays into per-element objects: tens of kilobytes for a real
    // picture, past the note's u16 prefix and past the whole glyph's densest tier — the export
    // crash behind "generated pixel art cannot be exported". The map itself codes small; only the
    // note had to go.
    const state = registerSynthetic(makeState(64, 64));
    const W = 48, H = 48;
    for (let y = 8; y < 8 + H; y += 2) for (let x = 8; x < 8 + W; x += 3) {
      state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 1 + ((x + y) % 4) };
    }
    state.generation = {
      algorithm: 'stencil', mode: 'earth', corridorWidth: 1, maxElevation: 8, seed: 7, region: null,
      stencilPlan: {
        read: 'color',
        stencil: { width: W, height: H, coverage: new Uint8Array(W * H).fill(255), color: new Uint32Array(W * H).fill(0xe74c3c) },
        origin: { x: 8, y: 8 },
      },
    };
    const bytes = await encodeMapPayload(state, null, META);
    expect(bytes.length).toBeLessThan(4096); // the note would have been ~50 KB on its own
    const dec = await decodeMapPayload(bytes);
    expect(dec.generation).toBeUndefined();
    expect(canonicalBytes(dec.canonical)).toEqual(canonicalBytes(canonicalize(state)));
  });

  it('a recipe too large for a note is dropped whole, never truncated', async () => {
    const state = registerSynthetic(makeState(64, 64));
    const region = [] as { x: number; y: number }[];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) region.push({ x, y });
    state.generation = { algorithm: 'designed', mode: 'earth', corridorWidth: 1, maxElevation: 6, seed: 3, region };
    const dec = await decodeMapPayload(await encodeMapPayload(state, null, META));
    expect(dec.generation).toBeUndefined();
  });
});
