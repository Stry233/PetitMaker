/**
 * A road material is a catalog item. Adding one is a JSON file, not a type edit, because the game
 * ships new surfaces the way it ships new houses.
 */
import { describe, it, expect } from 'vitest';
import { LOCALES } from '../../core/model/locale';
import { getRoadMaterials, getCatalogItem } from '../../state/catalog';
import { SHARE_CATALOG_ORDER } from '../../io/share/codec/catalog-order';
import { RETIRED_CATALOG_IDS } from '../../config/catalog/retired-ids';
import { surfaceUrl } from '../../assets/surface-urls';
import { ROAD_FEATHER } from '../../view/shared/road/shape';

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

  it('keeps connected material layers nested inside the supported feather', () => {
    for (const { roadMaterial: spec } of getRoadMaterials()) {
      if (!spec) continue;
      expect(spec.feather).toBeGreaterThan(0);
      expect(spec.feather).toBeLessThanOrEqual(ROAD_FEATHER);
      let inset = spec.feather;
      for (const layer of spec.layers) {
        expect(layer.inset).toBeGreaterThan(inset);
        expect(layer.color).toMatch(/^#[0-9a-f]{6}$/);
        inset = layer.inset;
      }
      if (spec.edgeJoints) {
        expect(spec.layers.length).toBeGreaterThan(0);
        expect(Number.isFinite(spec.edgeJoints.spacing)).toBe(true);
        expect(spec.edgeJoints.width).toBeGreaterThan(0);
        expect(spec.edgeJoints.width).toBeLessThan(spec.edgeJoints.spacing);
      }
    }
  });

  it('keeps authored paving finite and closes staggered rows across repeat seams', () => {
    for (const { roadMaterial: spec } of getRoadMaterials()) {
      if (!spec) continue;
      for (const { pattern } of [spec.edge, ...spec.layers]) {
        if (typeof pattern !== 'object') continue;
        expect(Number.isFinite(pattern.repeat)).toBe(true);
        expect(pattern.repeat).toBeGreaterThan(0);
        if (pattern.kind === 'image') { expect(surfaceUrl(pattern.image)).toBeTruthy(); continue; }
        if (pattern.kind === 'inlay' || pattern.kind === 'vector') continue;
        expect(Number.isFinite(pattern.joint)).toBe(true);
        expect(pattern.joint).toBeGreaterThan(0);
        if (pattern.kind === 'masonry') {
          expect(pattern.stones.length).toBeGreaterThan(0);
          for (const stone of pattern.stones) {
            expect(stone.points.length).toBeGreaterThanOrEqual(3);
            expect(stone.points.flat().every(Number.isFinite)).toBe(true);
          }
        } else {
          expect(pattern.rowSpacing).toBeGreaterThan(0);
          const rows = 1 / pattern.rowSpacing;
          expect(rows).toBeGreaterThan(0);
          expect(Number.isInteger(rows)).toBe(true);
          expect(rows % 2).toBe(0);
          expect(pattern.stagger).toBeGreaterThanOrEqual(0);
          expect(pattern.stagger).toBeLessThan(1);
          expect(pattern.rings.length).toBeGreaterThan(0);
          let radius = 0;
          for (const ring of pattern.rings) {
            expect(Number.isFinite(ring.radius)).toBe(true);
            expect(ring.radius).toBeGreaterThan(radius);
            expect(Number.isInteger(ring.segments)).toBe(true);
            expect(ring.segments).toBeGreaterThan(0);
            expect(ring.colors.length).toBeGreaterThan(0);
            radius = ring.radius;
          }
        }
      }
    }
  });

  // The append-only order itself (released prefix fixed, new ids appended not sorted in) is
  // guarded by catalog-order.test.ts; this only checks that every road material is present there.
  it('every material is registered in the share order', () => {
    for (const m of getRoadMaterials()) expect(SHARE_CATALOG_ORDER).toContain(m.id);
  });

  it('resolves through the ordinary catalog lookup, unremarkably', () => {
    expect(getCatalogItem('path-cobblestone')?.category).toBe('road');
    expect(getCatalogItem('path-simple-brick')?.category).toBe('road');
  });
});

describe('path tile surfaces', () => {
  it('offers only in-game paths', () => {
    const roads = getRoadMaterials();
    expect(roads.length).toBeGreaterThan(0);
    expect(roads.filter((r) => r.id.startsWith('path-'))).toHaveLength(roads.length);
  });

  it('arms the dirt path by default, which is what leading the category means', () => {
    // The tile brush and the road macros both fall back to the category's first item, so the
    // position is a decision rather than an artefact of the barrel's order.
    expect(getRoadMaterials()[0]!.id).toBe('path-overgrown-dirt');
  });

  it('holds none of the retired plain colour surfaces', () => {
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

  it('allows planting on the supported surfaces', () => {
    const plantable = getRoadMaterials()
      .filter((r) => r.traits?.some((t) => t.type === 'plantable'))
      .map((r) => r.id);
    expect(plantable).toEqual([
      'path-overgrown-dirt',
      'path-rustic-dirt',
      'path-tilled-soil',
      'path-park-stone',
      'path-garden-stone',
      'path-simple-flowerbed',
      'path-flower-meadow',
    ]);
  });

  it('names every path in all 7 locales', () => {
    for (const r of getRoadMaterials()) {
      for (const loc of LOCALES) {
        expect(r.name[loc], `${r.id} ${loc}`).toBeTruthy();
      }
    }
  });
});
