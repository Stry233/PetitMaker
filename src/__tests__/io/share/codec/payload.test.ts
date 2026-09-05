import { describe, it, expect } from 'vitest';
import { encodeMapPayload, decodeMapPayload } from '../../../../io/share/codec/payload';
import { canonicalize, canonicalBytes } from '../../../../io/share/canonical';
import { sha256 } from '../../../../io/share/crypto/sha256';
import { CompressionMethod, deflate, inflate } from '../../../../io/share/raster/zlib';
import { createBlankGridState } from '../../../../io/share/codec/blank-grid';
import { makeState } from '../../../rules/_helpers';
import { MAP_TEMPLATES } from '../../../../config/maps';
import { CellZone, TerrainType } from '../../../../core/model/types';
import { MODEL_VARIANTS } from '../../../../io/share/codec/map-coder';
import type { GridState } from '../../../../core/model/types';
import type { AnnotationsState } from '../../../../core/model/annotations';

// Register each synthetic test template so codec lookups use its current dimensions.
function registerSynthetic(state: GridState): GridState {
  MAP_TEMPLATES[state.template.id] = state.template;
  return state;
}

const META = { appVersion: '1.0-test', saveVersion: 3 };

function annotations(): AnnotationsState {
  return {
    items: [
      { kind: 'zone', id: 'z1', cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }], color: '#FF8A7A', name: 'Homes', num: 1, size: 'm' },
      { kind: 'text', id: 't1', x: 5.5, y: 6, text: 'Town square', style: 'chip', size: 'l', color: '#FFB347' },
      { kind: 'route', id: 'r1', points: [{ x: 1, y: 1 }, { x: 4.5, y: 2, hx: 1.5, hy: -0.5 }], color: '#2FBF9B', dashed: true },
    ],
    visible: false,
    locked: true,
  };
}

/** Convert an annotation-free frame 4 payload into the frame 3 layout and hash contract. */
async function asFrame3(frame4: Uint8Array, state: GridState): Promise<Uint8Array> {
  let offset = 5;
  offset += 1 + frame4[offset]!; // template id
  offset += 8; // template and catalog hashes
  offset += 1 + frame4[offset]!; // provenance record
  const hashOffset = offset;
  offset += 32;
  const noteLength = frame4[offset]! | (frame4[offset + 1]! << 8);
  offset += 2 + noteLength;
  const annotationLength = frame4[offset]! | (frame4[offset + 1]! << 8);
  if (annotationLength !== 0) throw new Error('frame 3 fixture must not contain annotations');

  const frame3 = new Uint8Array(frame4.length - 2);
  frame3.set(frame4.subarray(0, offset));
  frame3.set(frame4.subarray(offset + 2), offset);
  frame3[2] = 3;
  frame3.set(await sha256(canonicalBytes(canonicalize(state))), hashOffset);
  return frame3;
}

function annotationBlobRange(frame: Uint8Array): { lengthOffset: number; start: number; end: number } {
  let offset = 5;
  offset += 1 + frame[offset]!;
  offset += 8;
  offset += 1 + frame[offset]!;
  offset += 32;
  const noteLength = frame[offset]! | (frame[offset + 1]! << 8);
  offset += 2 + noteLength;
  const lengthOffset = offset;
  const length = frame[offset]! | (frame[offset + 1]! << 8);
  const start = offset + 2;
  return { lengthOffset, start, end: start + length };
}

describe('payload frame', () => {
  it('empty map round-trips tiny (< 150 B) and hash-exact', async () => {
    const state = createBlankGridState('hexia');
    const bytes = await encodeMapPayload(state, null, META);
    expect(bytes.length).toBeLessThan(150);
    const dec = await decodeMapPayload(bytes);
    expect(canonicalBytes(dec.canonical)).toEqual(canonicalBytes(canonicalize(state)));
  });
  it('treats an empty annotation layer as the annotation-free frame 4 case', async () => {
    const state = createBlankGridState('hexia');
    state.annotations = { items: [], visible: false, locked: true };
    const bytes = await encodeMapPayload(state, null, META);
    expect(bytes[2]).toBe(4);
    expect((await decodeMapPayload(bytes)).annotations).toBeUndefined();
  });
  it('round-trips every annotation kind and the layer state', async () => {
    const state = registerSynthetic(makeState(12, 12));
    state.annotations = annotations();
    const dec = await decodeMapPayload(await encodeMapPayload(state, null, META));
    expect(dec.annotations).toEqual(state.annotations);
  });
  it('rejects a valid annotation record that does not match the content hash', async () => {
    const state = registerSynthetic(makeState(12, 12));
    state.annotations = annotations();
    const frame = await encodeMapPayload(state, null, META);
    const range = annotationBlobRange(frame);
    const plain = await inflate(frame.subarray(range.start, range.end), CompressionMethod.Deflate, { maxBytes: 4 * 1024 * 1024, maxRatio: 256 });
    const changed = new TextEncoder().encode(new TextDecoder().decode(plain).replace('Homes', 'House'));
    const compressed = await deflate(changed, CompressionMethod.Deflate);
    const edited = new Uint8Array(frame.length - (range.end - range.start) + compressed.length);
    edited.set(frame.subarray(0, range.lengthOffset));
    edited[range.lengthOffset] = compressed.length & 0xff;
    edited[range.lengthOffset + 1] = compressed.length >>> 8;
    edited.set(compressed, range.start);
    edited.set(frame.subarray(range.end), range.start + compressed.length);
    await expect(decodeMapPayload(edited)).rejects.toMatchObject({ code: 'corrupt' });
  });
  it('continues to read annotation-free frame 3 payloads', async () => {
    const state = createBlankGridState('hexia');
    const frame3 = await asFrame3(await encodeMapPayload(state, null, META), state);
    const dec = await decodeMapPayload(frame3);
    expect(dec.annotations).toBeUndefined();
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
  it('falls back to an unmasked model when a state contains data outside the template mask', async () => {
    const state = createBlankGridState('hexia');
    let target: { x: number; y: number } | undefined;
    for (let y = 0; y < state.template.height && !target; y++) {
      for (let x = 0; x < state.template.width; x++) {
        if (state.template.zones[y]?.[x] !== CellZone.Grass) {
          target = { x, y };
          break;
        }
      }
    }
    state.cells[target!.y]![target!.x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
    const bytes = await encodeMapPayload(state, null, META);
    expect(MODEL_VARIANTS[bytes[3]!]!.templateMask).toBeUndefined();
    const decoded = await decodeMapPayload(bytes);
    expect(canonicalBytes(decoded.canonical)).toEqual(canonicalBytes(canonicalize(state)));
  });
  it('tampered bytes throw corrupt (hash gate)', async () => {
    const state = registerSynthetic(makeState(16, 16));
    // Non-empty terrain ensures the edited byte falls within decoded range-coder data.
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
    const bytes = await encodeMapPayload(state, null, META);
    bytes[Math.floor(bytes.length * 0.9)]! ^= 0x40;
    await expect(decodeMapPayload(bytes)).rejects.toMatchObject({ code: expect.stringMatching(/corrupt|decode-failed/) });
  });
  it('a model shape this build does not have reads as future, not corrupt', async () => {
    // Unknown append-only model indexes require a newer reader.
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

  it('a stencil recipe never rides because the map already carries its result', async () => {
    // Stencil source arrays are not compact JSON metadata; the canonical map contains the result.
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
    expect(bytes.length).toBeLessThan(4096);
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
