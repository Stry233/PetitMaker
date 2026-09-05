/**
 * The four plain colour roads were retired (#37) because the game has no such surface. Everything a
 * map can arrive in — a JSON save, an autosave, a sectioned export's undo history, a share code —
 * has to convert rather than lose its roads, and a share code has to keep verifying while it does.
 */
import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '../../io/json-codec';
import { decodeHistory, encodeHistory } from '../../io/history-codec';
import { RETIRED_CATALOG_IDS, currentCatalogId } from '../../io/legacy-catalog';
import { encodeMapPayload, decodeMapPayload } from '../../io/share/codec/payload';
import { createBlankGridState } from '../../io/share/codec/blank-grid';
import { toSaveJSON } from '../../io/share/canonical';
import { SHARE_CATALOG_ORDER } from '../../io/share/codec/catalog-order';
import { getMapTemplate } from '../../config/maps';
import { getCatalogItem } from '../../state/catalog';
import { CommandType, TerrainType } from '../../core/model/types';
import type { GridState, PlacedObject } from '../../core/model/types';
import type { HistoryEntry } from '../../core/commands/command-apply';
import { makeState, setTerrain } from '../rules/_helpers';

/** A save of an empty 10x10 map, ready for hand-written objects. */
function saveWith(objects: Record<string, unknown>[]) {
  const state = makeState(10, 10);
  setTerrain(state, 3, 3, TerrainType.Mountain, 2);
  const save = JSON.parse(serialize(state)) as Record<string, unknown>;
  save.objects = objects;
  return { json: JSON.stringify(save), template: state.template };
}

const road = (id: string, catalogId: string, x: number, y: number) =>
  ({ id, catalogId, x, y, rotation: 0, elevation: 0 });

describe('retired catalog ids', () => {
  it('name a replacement that is a road in the live catalog', () => {
    for (const [retired, replacement] of Object.entries(RETIRED_CATALOG_IDS)) {
      expect(getCatalogItem(retired), retired).toBeUndefined();
      expect(getCatalogItem(replacement)?.category, replacement).toBe('road');
    }
  });

  it('leaves every other id alone', () => {
    expect(currentCatalogId('tree-ginkgo')).toBe('tree-ginkgo');
    expect(currentCatalogId('path-cobblestone')).toBe('path-cobblestone');
  });
});

describe('a JSON save paved with the plain colour roads', () => {
  it('loads as the in-game surfaces they read as', () => {
    const { json, template } = saveWith([
      road('r1', 'road-dirt', 2, 2),
      road('r2', 'road-stone', 3, 2),
      road('r3', 'road-brick', 4, 2),
      road('r4', 'road-slate', 5, 2),
    ]);
    const state = deserialize(json, template);
    const byId = new Map([...state.objects.values()].map((o) => [o.id, o.catalogId]));
    expect(byId.get('r1')).toBe('path-rustic-dirt');
    expect(byId.get('r2')).toBe('path-garden-stone');
    expect(byId.get('r3')).toBe('path-lattice-red-brick');
    expect(byId.get('r4')).toBe('path-urban-asphalt');
  });

  it('keeps every road it arrived with, rather than dropping the unknown ids', () => {
    const { json, template } = saveWith([road('r1', 'road-dirt', 2, 2), road('r2', 'road-slate', 3, 2)]);
    const state = deserialize(json, template);
    // The plaza is recreated from the template, so it is in there too.
    expect([...state.objects.values()].filter((o) => o.catalogId.startsWith('path-'))).toHaveLength(2);
  });

  it('still drops an id that only LOOKS retired', () => {
    // The table is a rename, not a prefix rule: the injection guard must keep its teeth.
    const { json, template } = saveWith([road('r1', 'road-dirt-2', 2, 2), road('r2', 'road-dirtish', 3, 2)]);
    const state = deserialize(json, template);
    expect([...state.objects.values()].filter((o) => o.id.startsWith('r'))).toHaveLength(0);
  });
});

describe('an undo history written before the retirement', () => {
  const entry = (catalogId: string): HistoryEntry => {
    const object: PlacedObject = { id: 'o1', catalogId, position: { x: 2, y: 2 }, rotation: 0, elevation: 0 };
    return {
      cmd: { type: CommandType.PlaceObject, timestamp: 0, object, loadValue: 10 },
      before: [], after: [],
      objectOps: { removed: [], added: [object] },
    } as unknown as HistoryEntry;
  };

  it('replays with the replacement instead of being dropped whole', () => {
    const decoded = decodeHistory(encodeHistory([entry('road-stone')], 'all'), { width: 10, height: 10 });
    expect(decoded).toHaveLength(1);
    const cmd = decoded![0]!.cmd as { object: PlacedObject };
    expect(cmd.object.catalogId).toBe('path-garden-stone');
    expect(decoded![0]!.objectOps!.added[0]!.catalogId).toBe('path-garden-stone');
  });

  it('is still dropped for an id with no item and no replacement', () => {
    expect(decodeHistory(encodeHistory([entry('road-nonesuch')], 'all'), { width: 10, height: 10 })).toBeNull();
  });
});

describe('a share code written before the retirement', () => {
  /** A frame coded with a retired id, exactly as an already-shared image carries it: the wire order
   *  still holds the name at its old index, so the encoder writes the index it always wrote. */
  async function legacyFrame(): Promise<Uint8Array> {
    const s = createBlankGridState('hexia') as GridState;
    s.objects.set('r', { id: 'r', catalogId: 'road-dirt', position: { x: 20, y: 20 }, rotation: 0, elevation: 0 });
    s.objects.set('t', { id: 't', catalogId: 'tree-ginkgo', position: { x: 24, y: 20 }, rotation: 0, elevation: 0 });
    return encodeMapPayload(s, null, { appVersion: 'retired-pin', saveVersion: 1 });
  }

  it('keeps the retired name at its old index', () => {
    expect(SHARE_CATALOG_ORDER.indexOf('road-dirt')).toBe(47);
    expect(SHARE_CATALOG_ORDER.indexOf('road-stone')).toBe(48);
  });

  it('passes the content-hash gate, because the decoder hands back what was coded', async () => {
    // The hash covers the ids the decoder produced. Substituting inside the coded bytes would make
    // every code already in the wild a mismatch, so the payload layer must not know about the map.
    const dec = await decodeMapPayload(await legacyFrame());
    expect(dec.canonical.objects.map((o) => o.catalogId).sort()).toEqual(['road-dirt', 'tree-ginkgo']);
  });

  it('loads as the replacement once the decoded save becomes a map', async () => {
    // The steps importFromRaster takes after the gate.
    const dec = await decodeMapPayload(await legacyFrame());
    const state = deserialize(toSaveJSON(dec.canonical), getMapTemplate(dec.canonical.templateId));
    const ids = [...state.objects.values()].map((o) => o.catalogId);
    expect(ids).toContain('path-rustic-dirt');
    expect(ids).not.toContain('road-dirt');
  });
});
