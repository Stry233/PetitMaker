/**
 * A road material is a catalog item. Adding one is a JSON file, not a type edit, because the game
 * ships new surfaces the way it ships new houses.
 */
import { describe, it, expect } from 'vitest';
import { getRoadMaterials, getCatalogItem } from '../../state/catalog';
import { SHARE_CATALOG_ORDER } from '../../io/share/codec/catalog-order';

describe('road materials', () => {
  it('come from the catalog, not a union: both legacy and newly-added ids flow through', () => {
    const ids = getRoadMaterials().map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['road-dirt', 'road-stone', 'road-brick', 'road-slate']));
  });

  it('each carries what a swatch needs', () => {
    for (const m of getRoadMaterials()) {
      expect(m.color, `${m.id} has no colour`).toBeTruthy();
      expect(m.name.en, `${m.id} has no English name`).toBeTruthy();
    }
  });

  // The append-only ORDER itself (released prefix fixed, new ids appended not sorted in) is
  // guarded by catalog-order.test.ts; this only checks that every road material is present there.
  it('every material is registered in the share order', () => {
    for (const m of getRoadMaterials()) expect(SHARE_CATALOG_ORDER).toContain(m.id);
  });

  it('resolves through the ordinary catalog lookup, unremarkably', () => {
    expect(getCatalogItem('road-brick')?.category).toBe('road');
    expect(getCatalogItem('road-slate')?.category).toBe('road');
  });
});
