// Every tree and flower names its species and colour family, the species registry and the catalog
// agree in both directions, and the hand-drawn set pieces name real items of the colours and species
// their drawings depend on.
import { describe, it, expect } from 'vitest';
import { COLOR_FAMILIES } from '../../../core/model/types';
import { getAllItems, getCatalogItem } from '../../../state/catalog';
import { PLANT_SET_PIECES, PLANT_SPECIES, plantSpecies } from '../../../config/catalog/plant-species';
import { ItemCategory } from '../../../config/catalog/categories';

const plants = getAllItems().filter((i) => i.category === ItemCategory.Tree || i.category === ItemCategory.Flora);

describe('plant species', () => {
  it('gives every tree and flower a registered species of its own category and a colour family', () => {
    expect(plants.length).toBeGreaterThan(0);
    for (const item of plants) {
      expect(item.plant, `${item.id} names no plant facts`).toBeDefined();
      const species = plantSpecies(item.plant!.species);
      expect(species, `${item.id}: unknown species ${item.plant!.species}`).toBeDefined();
      expect(species!.category, item.id).toBe(item.category);
      expect(COLOR_FAMILIES, item.id).toContain(item.plant!.colorFamily);
    }
  });

  it('lists each species once, every one carried by at least one item', () => {
    const ids = PLANT_SPECIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const species of PLANT_SPECIES) {
      expect(plants.some((i) => i.plant?.species === species.id), species.id).toBe(true);
    }
  });

  it('names one climax species per category, at the oldest tier', () => {
    for (const category of [ItemCategory.Tree, ItemCategory.Flora]) {
      const climax = PLANT_SPECIES.filter((s) => s.category === category && s.climax);
      expect(climax, category).toHaveLength(1);
      expect(climax[0]!.tier).toBe(3);
      expect(getCatalogItem(climax[0]!.id), `${climax[0]!.id} is placed by its species id`).toBeDefined();
    }
  });

  it('draws the set pieces from real items of the colours and species they need', () => {
    for (const id of PLANT_SET_PIECES.fairyRing) expect(getCatalogItem(id)?.plant?.colorFamily, id).toBe('white');
    for (const [fill, outline] of PLANT_SET_PIECES.heartPairs) {
      const a = getCatalogItem(fill), b = getCatalogItem(outline);
      expect(a && b, `${fill} / ${outline}`).toBeTruthy();
      expect(a!.plant?.species, fill).toBe(b!.plant?.species);
    }
  });
});
