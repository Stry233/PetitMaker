/**
 * The catalog JSON is cast to `CatalogItem` where it loads, so nothing but this file checks that the
 * data has the shape the type promises: every item the editor may meet, disabled ones and landmarks
 * included, carries the required fields and no key the type does not name (a misspelled optional key
 * would otherwise read as absent), and every trait it declares is one placement validates.
 */
import { describe, it, expect } from 'vitest';
import { getKnownItems } from '../../../state/catalog';
import { CATEGORY_BY_ID } from '../../../config/catalog/categories';
import { traitPlacementRule } from '../../../rules/placement';
import { placeObjectCommand } from '../../../core/model/command-build';
import { makeState } from '../../_support/map-state';
import type { PlacementTrait } from '../../../core/model/types';
import type { CatalogEntry } from '../../../config/catalog/catalog-entry';
import { LOCALES } from '../../../core/model/locale';

/** The fields each trait carries beside `type`, numbers unless typed `:boolean`; `?` marks an
 *  optional one. */
const TRAIT_FIELDS: Record<PlacementTrait['type'], readonly string[]> = {
  flat: [], noFloat: [], coatingSupport: [], plantable: [], growsOnPlantable: [], terrainBase: [],
  halfStep: [], footprintTurn: [],
  waterSpan: ['min', 'max'],
  heightDrop: ['layers'],
  surfaceCoating: ['layer?'],
  exclusionRadius: ['radius'],
  groundZones: ['onGrass:boolean', 'onSand:boolean', 'acrossBoundary:boolean'],
};

/** A `TRAIT_FIELDS` entry's key and the type its value has. */
const fieldOf = (field: string): { name: string; type: string; optional: boolean } => {
  const [key, type = 'number'] = field.replace('?', '').split(':');
  return { name: key!, type, optional: field.endsWith('?') };
};

/** Every key a catalog entry may carry. `satisfies` holds it to the type both ways: a key the type
 *  gains or loses is a compile error here, so the runtime check below cannot drift from it. */
const ENTRY_KEYS = {
  id: true, category: true, name: true, icon: true, color: true, width: true, height: true,
  loadValue: true, loadUnknown: true, maxCount: true, ruleTBD: true, disabled: true, rotatable: true,
  artInFootprint: true, placementMode: true, traits: true, strokeConnections: true, strokeCurve: true,
  plant: true, iconColor: true, footprintColor: true, roadMaterial: true, surfacePrint: true, aliases: true,
} as const satisfies Record<keyof CatalogEntry, true>;

const PLANT_KEYS = { species: true, colorFamily: true } as const satisfies Record<keyof NonNullable<CatalogEntry['plant']>, true>;

/** The keys of `value` that `allowed` does not name. */
const strayKeys = (value: object, allowed: readonly string[]): string[] =>
  Object.keys(value).filter((key) => !allowed.includes(key));

const items = getKnownItems();

describe('catalog data', () => {
  it.each(items.map((item) => [item.id, item] as const))('%s carries the required fields', (_id, item) => {
    expect(typeof item.id).toBe('string');
    expect(CATEGORY_BY_ID.has(item.category)).toBe(true);
    expect(item.name.en).toBeTruthy();
    expect(item.name.zh).toBeTruthy();
    expect(item.icon ?? item.color).toBeTruthy();
    for (const size of [item.width, item.height]) expect(size).toBeGreaterThan(0);
    expect(Number.isFinite(item.loadValue)).toBe(true);
    expect(typeof item.rotatable).toBe('boolean');
    expect(['point', 'brush']).toContain(item.placementMode);
    expect(Array.isArray(item.traits)).toBe(true);
    for (const trait of item.traits) {
      for (const field of TRAIT_FIELDS[trait.type] ?? []) {
        const { name, type, optional } = fieldOf(field);
        const value = (trait as unknown as Record<string, unknown>)[name];
        if (optional && value === undefined) continue;
        expect(typeof value, `${trait.type}.${name}`).toBe(type);
      }
    }
  });

  it.each(items.map((item) => [item.id, item] as const))('%s carries only keys its type names', (_id, item) => {
    expect(strayKeys(item, Object.keys(ENTRY_KEYS))).toEqual([]);
    expect(strayKeys(item.name, LOCALES)).toEqual([]);
    if (item.plant) expect(strayKeys(item.plant, Object.keys(PLANT_KEYS))).toEqual([]);
    for (const trait of item.traits) {
      const fields = TRAIT_FIELDS[trait.type];
      expect(fields, trait.type).toBeDefined();
      expect(strayKeys(trait, ['type', ...(fields ?? []).map((f) => fieldOf(f).name)])).toEqual([]);
    }
  });

  it.each(items.map((item) => [item.id, item] as const))('%s declares only traits placement validates', (_id, item) => {
    const state = makeState(40, 40);
    const cmd = placeObjectCommand({ id: 'probe', catalogId: item.id, position: { x: 10, y: 10 }, rotation: 0, elevation: 0 });
    expect(() => traitPlacementRule.validate(cmd, state)).not.toThrow();
  });
});
