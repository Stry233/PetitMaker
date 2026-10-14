import { describe, expect, it } from 'vitest';
import { decodeMapPayload, encodeMapPayload } from '../../../../io/share/codec/payload';
import { ImportError } from '../../../../io/save/import-error';
import { createGridState } from '../../../../core/model/template';
import { getMapTemplate } from '../../../../config/maps';
import { TerrainType, type GridState } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';

const META = { appVersion: '1.0-test', saveVersion: 3 };

/** Hexia with a mountain block and a note, so the frame carries a residual and a notes record. */
function edited(): GridState {
  const state = createGridState(getMapTemplate('hexia'));
  let painted = 0;
  for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) {
    if (state.cells[y]?.[x]?.zone !== CellZone.Grass) continue;
    state.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 1 + (painted++ % 3) };
  }
  state.notes = { title: 'Ridge', description: '' };
  return state;
}

async function code(bytes: Uint8Array): Promise<string> {
  try {
    await decodeMapPayload(bytes);
    return 'decoded';
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as ImportError).code;
  }
}

describe('damaged share payloads', () => {
  it.each([0, 1, 2])('a %s-byte payload is a typed failure', async (length) => {
    const bytes = new Uint8Array(length).fill(0x50);
    expect(['corrupt', 'decode-failed']).toContain(await code(bytes));
  });

  it('every strict prefix of a real payload fails with a typed error or reads back the same map', async () => {
    const bytes = await encodeMapPayload(edited(), null, META);
    const reference = JSON.stringify((await decodeMapPayload(bytes)).canonical);
    let firstDecoded = bytes.length;
    for (let n = 0; n < bytes.length; n++) {
      const prefix = bytes.slice(0, n);
      const outcome = await code(prefix);
      if (outcome !== 'decoded') continue;
      firstDecoded = Math.min(firstDecoded, n);
      // The range coder's final bytes can be implied; the content hash proves the map is unchanged.
      expect(JSON.stringify((await decodeMapPayload(prefix)).canonical), `prefix ${n}`).toBe(reference);
    }
    // Every record before the map residual is length-checked.
    expect(firstDecoded).toBeGreaterThan(bytes.length / 2);
  });

  it('a frame older than the earliest published one is unsupported, never future', async () => {
    const bytes = await encodeMapPayload(edited(), null, META);
    for (const version of [0, 1, 2]) {
      const old = bytes.slice();
      old[2] = version;
      expect(await code(old)).toBe('decode-failed');
    }
  });

  it('flipping any bit of the magic or the content hash is refused', async () => {
    const bytes = await encodeMapPayload(edited(), null, META);
    // Header: magic(2) version(1) variant(1) canonical version(1) id(str8) hashes(8) provenance(blob8) hash(32).
    let offset = 5;
    offset += 1 + bytes[offset]!;
    offset += 8;
    offset += 1 + bytes[offset]!;
    const hashBits = [...Array(32 * 8).keys()].map((bit) => (offset * 8) + bit);
    for (const bit of [...Array(16).keys(), ...hashBits]) {
      const damaged = bytes.slice();
      damaged[bit >> 3]! ^= 1 << (bit & 7);
      expect(await code(damaged), `bit ${bit}`).toBe('corrupt');
    }
  });

  it('flipping any bit of the template id never decodes onto another planet', async () => {
    const bytes = await encodeMapPayload(edited(), null, META);
    const idLength = bytes[5]!;
    for (let bit = 0; bit < idLength * 8; bit++) {
      const damaged = bytes.slice();
      damaged[6 + (bit >> 3)]! ^= 1 << (bit & 7);
      expect(['incompatible-template', 'corrupt', 'decode-failed'], `bit ${bit}`).toContain(await code(damaged));
    }
  });

  it('flipping any single bit after the header never yields a different map', { timeout: 30_000 }, async () => {
    const state = edited();
    const bytes = await encodeMapPayload(state, null, META);
    const reference = JSON.stringify((await decodeMapPayload(bytes)).canonical);
    let offset = 5;
    offset += 1 + bytes[offset]!;
    offset += 8;
    offset += 1 + bytes[offset]!;
    offset += 32;
    for (let bit = offset * 8; bit < bytes.length * 8; bit++) {
      const damaged = bytes.slice();
      damaged[bit >> 3]! ^= 1 << (bit & 7);
      try {
        const decoded = await decodeMapPayload(damaged);
        // Only bits outside the hashed content (the generation note) may still decode, and the map must be the same.
        expect(JSON.stringify(decoded.canonical), `bit ${bit}`).toBe(reference);
      } catch (e) {
        expect(e).toBeInstanceOf(ImportError);
      }
    }
  });
});
