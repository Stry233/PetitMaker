/**
 * A road material is a catalog item. Adding one is a JSON file, not a type edit, because the game
 * ships new surfaces the way it ships new houses.
 */
import { describe, it, expect } from 'vitest';
import { getRoadMaterials, getCatalogItem } from '../../state/catalog';
import { SHARE_CATALOG_ORDER } from '../../io/share/codec/catalog-order';
import { RETIRED_CATALOG_IDS } from '../../io/legacy-catalog';

describe('road materials', () => {
  it('come from the catalog, not a union', () => {
    const ids = getRoadMaterials().map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['path-overgrown-dirt', 'path-cobblestone', 'path-simple-brick']));
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
    expect(getCatalogItem('path-cobblestone')?.category).toBe('road');
    expect(getCatalogItem('path-simple-brick')?.category).toBe('road');
  });
});

describe('path tile surfaces (#22, #37)', () => {
  it('has 25 surfaces, every one of them an in-game path', () => {
    const roads = getRoadMaterials();
    expect(roads).toHaveLength(25);
    expect(roads.filter((r) => r.id.startsWith('path-'))).toHaveLength(25);
  });

  it('arms the dirt path by default, which is what leading the category means', () => {
    // The tile brush and the road macros both fall back to the category's first item, so the
    // position is a decision rather than an artefact of the barrel's order.
    expect(getRoadMaterials()[0]!.id).toBe('path-overgrown-dirt');
  });

  it('holds none of the four retired plain colour surfaces (#37)', () => {
    // They were not in the game, so a map paved with one could not be rebuilt there.
    for (const id of Object.keys(RETIRED_CATALOG_IDS)) expect(getCatalogItem(id), id).toBeUndefined();
  });

  it('every path item carries icon + color', () => {
    for (const r of getRoadMaterials()) {
      expect(r.icon, r.id).toBe(r.id);
      expect(r.color, r.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(r.width).toBe(1);
      expect(r.height).toBe(1);
      expect(r.traits?.some((t) => t.type === 'surfaceCoating'), r.id).toBe(true);
      expect(r.traits?.some((t) => t.type === 'flat'), r.id).toBe(true);
    }
  });

  it('plants on the dirt path and nowhere else', () => {
    // The trait came in with the plain dirt road (issue #11) and moved to the surface that replaced
    // it, so a map that had flowers standing on a dirt road still loads legal.
    const plantable = getRoadMaterials()
      .filter((r) => r.traits?.some((t) => t.type === 'plantable'))
      .map((r) => r.id);
    expect(plantable).toEqual(['path-overgrown-dirt']);
  });

  it('names every path in all 7 locales', () => {
    for (const r of getRoadMaterials()) {
      for (const loc of ['en', 'zh', 'ja', 'ru', 'th', 'id', 'fr'] as const) {
        expect(r.name[loc], `${r.id} ${loc}`).toBeTruthy();
      }
    }
  });
});
