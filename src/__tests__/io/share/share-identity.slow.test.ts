/**
 * Frozen share codes and saves keep their maps. Corrected catalog footprints update only the catalog
 * signature on re-export; every other payload byte and each map's canonical digest stays fixed. A code
 * whose map the current rules repair opens repaired, and its re-export opens as that repaired map.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import pinned from '../../fixtures/share/share-identity.json';
import {
  SAVE_FIXTURES, SHARE_META, canonicalSha, decodeMapPayload, encodeMapPayload, hex, importPayload, loadSaveFixture,
} from '../../_support/share-identity';
import { catalogHash, templateHash } from '../../../io/save/canonical';
import { serialize } from '../../../io/save/json-codec';
import { deserialize } from '../../_support/save-file';
import { importDriftWarnings } from '../../../io/share/validate';
import { MAP_LIST } from '../../../config/maps';
import { setToastPresenter } from '../../../platform/channels/toast-bus';

vi.setConfig({ testTimeout: 30_000 });

/** `opened`: the save file's map once its automatic repair has landed, where that differs from
 *  the map its share code was written from. */
interface PinnedCase { payload: string; canonical: string; templateId: string; opened?: string }
const CASES = Object.entries(pinned.cases as Record<string, PinnedCase>);
const CURRENT_CATALOG_HASH = 3180557252;

beforeAll(() => setToastPresenter(() => {}));

describe('recorded identities', () => {
  it('signs the catalog with the corrected five-by-five neighbor footprints', () => {
    expect(catalogHash()).toBe(CURRENT_CATALOG_HASH);
  });

  it.each(MAP_LIST.map((t) => [t.id, t] as const))('signs built-in planet %s as it always has', (id, t) => {
    expect(templateHash(t)).toBe((pinned.templateHashes as Record<string, number>)[id]);
  });
});

describe('a recorded share code', () => {
  it.each(CASES)('%s preserves its map and updates only the catalog signature on re-export', async (_name, c) => {
    const bytes = Uint8Array.from(Buffer.from(c.payload, 'base64'));
    const dec = await decodeMapPayload(bytes);
    const { state, repaired } = importPayload(dec);
    expect(state.template.id).toBe(c.templateId);
    expect(dec.catalogHash).toBe(pinned.catalogHash);
    expect(importDriftWarnings(state.template, dec)).toEqual([{ kind: 'catalog-drift' }]);
    expect(await canonicalSha(state)).toBe(c.canonical);
    expect(await canonicalSha(deserialize(serialize(state), state.template))).toBe(c.canonical);
    const exported = await encodeMapPayload(state, null, SHARE_META);
    expect(importDriftWarnings(state.template, await decodeMapPayload(exported))).toEqual([]);
    // A code whose map the current rules repair re-exports the repaired map, which opens unchanged.
    if (repaired) {
      const again = importPayload(await decodeMapPayload(exported));
      expect(again.repaired).toBe(false);
      expect(await canonicalSha(again.state)).toBe(c.canonical);
      return;
    }
    // Five header bytes precede the length-prefixed template id and its four-byte signature.
    const signatureOffset = 10 + bytes[5]!;
    const expected = bytes.slice();
    expect(new DataView(expected.buffer).getUint32(signatureOffset, true)).toBe(pinned.catalogHash);
    new DataView(expected.buffer).setUint32(signatureOffset, CURRENT_CATALOG_HASH, true);
    expect(hex(exported)).toBe(hex(expected));
  });
});

describe('a save fixture', () => {
  it.each(SAVE_FIXTURES)('%s loads to the map it always has', async (name) => {
    const pin = (pinned.cases as Record<string, PinnedCase>)[`save/${name}`]!;
    expect(await canonicalSha(loadSaveFixture(name))).toBe(pin.opened ?? pin.canonical);
  });
});
