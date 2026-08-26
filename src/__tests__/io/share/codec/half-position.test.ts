// Half-cell positions on the wire. Two obligations pull against each other and both are pinned
// here: a map that holds no half position must code to the SAME bytes it always did, and a map
// that holds one must come back exact.
import { describe, it, expect } from 'vitest';
import { encodeMapPayload, decodeMapPayload } from '../../../../io/share/codec/payload';
import { createBlankGridState } from '../../../../io/share/codec/blank-grid';
import { canonicalize, canonicalBytes } from '../../../../io/share/canonical';
import { encodeMap, decodeMap, MODEL_VARIANTS } from '../../../../io/share/codec/map-coder';
import { RangeEncoder, RangeDecoder } from '../../../../io/share/codec/bitio';
import { tokensOf, parseToken } from '../../../../io/share/codec/grid-io';
import { getMapTemplate } from '../../../../config/maps';
import { buildShareCode, importFromRaster } from '../../../../io/share';
import { CURRENT_VERSION } from '../../../../io/save-format';
import { TerrainType } from '../../../../core/model/types';
import type { GridState } from '../../../../core/model/types';
import type { SaveObject } from '../../../../io/save-format';

const META = { appVersion: 'half-pin', saveVersion: 1 };

const hex = (b: Uint8Array) => [...b].map((v) => v.toString(16).padStart(2, '0')).join('');

function place(
  s: GridState, id: string, catalogId: string, x: number, y: number,
  rotation: 0 | 90 | 180 | 270, elevation: number, spanLength?: number,
): void {
  s.objects.set(id, {
    id, catalogId, position: { x, y }, rotation, elevation,
    ...(spanLength !== undefined ? { spanLength } : {}),
  });
}

/** A hand-built map with terrain and a mixed object set, every anchor on a whole cell. Built by
 *  direct writes rather than the generator so the bytes below depend on this file alone. */
function wholeMap(): GridState {
  const s = createBlankGridState('hexia');
  for (let y = 20; y < 26; y++) for (let x = 20; x < 28; x++) {
    s.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
  }
  for (let x = 30; x < 34; x++) s.cells[24]![x]!.terrain = { type: TerrainType.Water, elevation: 0 };
  place(s, 'a', 'tree-ginkgo', 18, 18, 0, 0);
  place(s, 'b', 'path-garden-stone', 19, 19, 0, 0);
  place(s, 'c', 'bridge-plank', 29, 24, 90, 0, 4);
  place(s, 'd', 'ramp-plank', 20, 27, 180, 2);
  return s;
}

describe('share codec: half positions are additive', () => {
  it('codes a map with no half position to the bytes it always did', async () => {
    // A FROZEN pin, taken from the encoder before it learned about half positions. Every share
    // code in the wild was written by that encoder; a change here means codes stop matching the
    // ones the same map produced yesterday, so this must fail loudly rather than drift.
    // The frame's catalogHash bytes shift whenever the catalog's item set changes. That is
    // expected and is not a position-format change: re-freeze the four bytes, and only those.
    // Re-frozen whole once, when the four plain colour roads were retired (#37): this map paved
    // with one, so the item it now names moved its wire index and the content hash with it.
    const bytes = await encodeMapPayload(wholeMap(), null, META);
    expect(hex(bytes)).toBe('5032030001056865786961fd3134f1f7e4e61d0b00010868616c662d70696e26b988de59648006f79e42eef0219177224daae786bc4b08b9d3ff70cc63f503000000000344927b32bc639534e56b6a2c4ab69c73f633d9fbdab19376000c66d4970d587d0f00000000000000011b7de923f0005597ce127d6bb1f38e7828b110f000000000');
  });

  it('returns a map with no half position exactly', async () => {
    const state = wholeMap();
    const dec = await decodeMapPayload(await encodeMapPayload(state, null, META));
    expect(canonicalBytes(dec.canonical)).toEqual(canonicalBytes(canonicalize(state)));
  });

  it('returns a half-anchored ramp and bridge exactly', async () => {
    const state = wholeMap();
    place(state, 'e', 'ramp-teak-stair', 40.5, 30, 0, 1);
    place(state, 'f', 'bridge-teak', 44, 50.5, 90, 0, 4);
    place(state, 'g', 'ramp-plank', 60.5, 60.5, 270, 2);
    const dec = await decodeMapPayload(await encodeMapPayload(state, null, META));
    expect(canonicalBytes(dec.canonical)).toEqual(canonicalBytes(canonicalize(state)));
    const by = new Map(dec.canonical.objects.map((o) => [o.catalogId, o]));
    expect([by.get('ramp-teak-stair')!.x, by.get('ramp-teak-stair')!.y]).toEqual([40.5, 30]);
    expect([by.get('bridge-teak')!.x, by.get('bridge-teak')!.y]).toEqual([44, 50.5]);
  });

  it('names a half-capable shape only when the map holds one', async () => {
    // The frame's 4th byte is the model shape. Byte-identity above already proves shapes 0 and 1
    // are untouched; this is the other half of the claim: the new shapes cost nothing until a
    // half position exists, and are the only ones that can carry it.
    const plain = await encodeMapPayload(wholeMap(), null, META);
    expect(MODEL_VARIANTS[plain[3]!]!.half).toBe(false);

    const state = wholeMap();
    place(state, 'e', 'ramp-teak-stair', 40.5, 30, 0, 1);
    const half = await encodeMapPayload(state, null, META);
    expect(MODEL_VARIANTS[half[3]!]!.half).toBe(true);
  });

  it('refuses a position a shape cannot carry', () => {
    const template = getMapTemplate('hexia');
    const cells = tokensOf(canonicalize(createBlankGridState('hexia')).cells).map(parseToken);
    const at = (x: number, y: number): SaveObject[] =>
      [{ id: 'o0', catalogId: 'ramp-plank', x, y, rotation: 0 }];
    const code = (objects: SaveObject[], variant: number) =>
      encodeMap(new RangeEncoder(), template, cells, objects, MODEL_VARIANTS[variant]!);
    // A whole-cell shape has nowhere to put the offset; a quarter cell is off both grids.
    expect(() => code(at(10.5, 10), 0)).toThrow(/half/);
    expect(() => code(at(10.25, 10), 2)).toThrow(/half grid/);
  });

  it('costs nothing measurable per object to carry the half-capable shape', () => {
    // The bit is one adaptive symbol per object and every object but one says "whole", so the
    // shape's cost has to stay in the noise rather than scale the object plane.
    const template = getMapTemplate('hexia');
    const cells = tokensOf(canonicalize(createBlankGridState('hexia')).cells).map(parseToken);
    const objects: SaveObject[] = [];
    for (let i = 0; i < 1000; i++) {
      objects.push({ id: `o${i}`, catalogId: 'tree-ginkgo', x: 20 + (i % 40), y: 20 + Math.floor(i / 40), rotation: 0 });
    }
    const size = (variant: number) => {
      const enc = new RangeEncoder();
      encodeMap(enc, template, cells, objects, MODEL_VARIANTS[variant]!);
      return enc.finish().length;
    };
    expect(size(2) - size(0)).toBeLessThan(objects.length / 8 / 4); // under a quarter bit each
  });

  it('carries a half anchor the whole way out and back', async () => {
    // The live path: the code is drawn, read back off the pixels, and rebuilt through the save
    // loader and the import gate — the two places that decide whether a position may sit off the
    // whole-cell grid.
    const state = wholeMap();
    place(state, 'e', 'ramp-teak-stair', 40.5, 30, 0, 1);
    place(state, 'f', 'bridge-teak', 44, 50.5, 90, 0, 4);
    const code = await buildShareCode(state, null, { ...META, saveVersion: CURRENT_VERSION }, 1600);
    const res = await importFromRaster(code!.rgba, code!.width, code!.height);
    expect(res.ok && res.warnings).toEqual([]);
    const objects = [...(res as { state: GridState }).state.objects.values()];
    expect(objects.find((o) => o.catalogId === 'ramp-teak-stair')!.position).toEqual({ x: 40.5, y: 30 });
    expect(objects.find((o) => o.catalogId === 'bridge-teak')!.position).toEqual({ x: 44, y: 50.5 });
  }, 60_000);

  it('carries a half anchor under both parities', () => {
    const template = getMapTemplate('hexia');
    const cells = tokensOf(canonicalize(createBlankGridState('hexia')).cells).map(parseToken);
    const objects: SaveObject[] = [
      { id: 'o0', catalogId: 'ramp-plank', x: 10.5, y: 11, rotation: 0 },
      { id: 'o1', catalogId: 'bridge-teak', x: 20, y: 21.5, rotation: 90, spanLength: 3 },
      { id: 'o2', catalogId: 'ramp-teak-stair', x: 30.5, y: 31.5, rotation: 180 },
    ];
    for (const v of [2, 3]) {
      const enc = new RangeEncoder();
      encodeMap(enc, template, cells, objects, MODEL_VARIANTS[v]!);
      const got = decodeMap(new RangeDecoder(enc.finish()), template, MODEL_VARIANTS[v]!);
      expect(got.objects.map((o) => `${o.catalogId}@${o.x},${o.y}`).sort())
        .toEqual(objects.map((o) => `${o.catalogId}@${o.x},${o.y}`).sort());
    }
  });
});
