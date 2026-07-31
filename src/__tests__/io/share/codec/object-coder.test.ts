import { describe, it, expect } from 'vitest';
import { RangeEncoder, RangeDecoder, UintModel, encodeUint } from '../../../../io/share/codec/bitio';
import { encodeObjects, decodeObjects } from '../../../../io/share/codec/object-coder';
import { getAllItems, getCatalogItem } from '../../../../state/catalog';
import { objKey } from '../../../../io/share/canonical';
import type { SaveObject } from '../../../../io/save-format';
import { ItemCategory } from '../../../../core/model/types';

// category is derived from the catalog item (same as the coder's normalize()) so a hand-built
// object is already normalize()-stable — the coder re-derives category from the catalog, so a
// literal that disagreed with the real catalog category could never round-trip byte-for-byte.
function mk(i: number, catalogId: string, x: number, y: number, extra: Partial<SaveObject> = {}): SaveObject {
  return { id: `o${i}`, catalogId, x, y, rotation: 0, ...extra };
}
function canonicalSortIds(objs: SaveObject[]): SaveObject[] {
  // The coder itself must return objects sorted + re-id'd exactly like canonicalize.
  return objs.map((o, i) => ({ ...o, id: `o${i}` }));
}
describe('object coder', () => {
  const ids = getAllItems().map((it) => it.id).sort();
  const objs = canonicalSortIds([
    mk(0, ids[0]!, 3, 4, { elevation: 0 }),
    mk(1, ids[1]!, 5, 4, { elevation: 2, rotation: 90 }),
    mk(2, ids[2]!, 9, 12, { elevation: 0, spanLength: 4 }),
  ]);
  it('round-trips vs empty predictor', () => {
    const enc = new RangeEncoder(); encodeObjects(enc, objs, []);
    const back = decodeObjects(new RangeDecoder(enc.finish()), []);
    expect(back).toEqual(objs);
  });
  it('identical list vs predictor costs almost nothing and round-trips', () => {
    const enc = new RangeEncoder(); encodeObjects(enc, objs, objs);
    const buf = enc.finish();
    expect(buf.length).toBeLessThan(12);
    expect(decodeObjects(new RangeDecoder(buf), objs)).toEqual(objs);
  });
  it('add + delete residual round-trips', () => {
    // Sort by the real canonical key (objKey), not an ad-hoc comparator — the coder's normalize()
    // re-sorts by objKey, so the expected list must already be in that exact order.
    const edited = canonicalSortIds([objs[0]!, objs[2]!, mk(9, ids[3]!, 1, 1, { elevation: 0 })]
      .sort((a, b) => (objKey(a) < objKey(b) ? -1 : 1)));
    const enc = new RangeEncoder(); encodeObjects(enc, edited, objs);
    expect(decodeObjects(new RangeDecoder(enc.finish()), objs)).toEqual(edited);
  });
  it('carries no category: the reader derives it from the catalogId', () => {
    const objs = canonicalSortIds([
      { id: 'o0', catalogId: 'road-dirt', x: 2, y: 2, rotation: 0 },
    ]);
    const enc = new RangeEncoder(); encodeObjects(enc, objs, []);
    const back = decodeObjects(new RangeDecoder(enc.finish()), []);
    expect(back).toEqual(objs);
    expect(getCatalogItem(back[0]!.catalogId)!.category).toBe(ItemCategory.Road);
  });
  it('encodeObjects throws on an unknown catalogId', () => {
    const bogus: SaveObject = { id: 'o0', catalogId: 'does-not-exist', x: 0, y: 0, rotation: 0 };
    const enc = new RangeEncoder();
    expect(() => encodeObjects(enc, [bogus], [])).toThrow(/unknown catalogId/);
  });
  it('rejects implausible list counts (hostile payload guard)', () => {
    const enc = new RangeEncoder();
    encodeUint(enc, new UintModel(), 60001); // forged delCount > MAX_LIST
    expect(() => decodeObjects(new RangeDecoder(enc.finish()), [])).toThrow(/implausible/);
  });
});
