// The colour vocabulary and the unity operator. Two claims are worth a test: the authored table is
// COMPLETE over the live catalog (an item missing from it silently falls back to the model-derived
// reading the table exists to correct), and a region's palette is a DOMINANT family rather than a
// pair, since the unity score asks for one family over 60% of a region's decor.
import { describe, it, expect } from 'vitest';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { ItemCategory } from '../../../../../core/model/types';
import { getPlaceableByCategory } from '../../../../../state/catalog';
import { planDesignFor } from '../_design-plan';
import {
  PLANT_FAMILIES, familyOf, flowerFamilies, planPalettes, speciesOf,
} from '../../../../../tools/generation/designer/dressing/palette';

const HEXIA = MAP_TEMPLATES['hexia']!;
const ROLES = ['mass', 'edge', 'accent', 'grove', 'grove-accent'] as const;

describe('the authored colour table', () => {
  it('names every placeable tree and flower', () => {
    for (const category of [ItemCategory.Tree, ItemCategory.Flora]) {
      for (const item of getPlaceableByCategory(category)) {
        expect(PLANT_FAMILIES[item.id], `${item.id} is missing from PLANT_FAMILIES`).toBeDefined();
      }
    }
  });

  it('falls back to the model-derived reading for an id it does not carry', () => {
    expect(familyOf('not-a-catalog-item')).toBe('unknown');
  });

  it('leaves the trees green but for the three the icons draw in colour', () => {
    const coloured = getPlaceableByCategory(ItemCategory.Tree)
      .map((i) => i.id)
      .filter((id) => familyOf(id) !== 'green');
    expect(coloured.sort()).toEqual(['tree-flame', 'tree-ginkgo', 'tree-peach']);
  });

  it('offers a flower in every family a region may draw', () => {
    for (const family of flowerFamilies()) {
      expect(speciesOf(ItemCategory.Flora, family).length, family).toBeGreaterThan(0);
    }
    expect(flowerFamilies().length).toBeGreaterThan(4);
  });
});

describe('the unity operator', () => {
  it('gives every region a palette whose roles all name a real species', () => {
    const plan = planDesignFor(4242, HEXIA, 0.5);
    const palettes = planPalettes(plan, 4242);
    for (const region of plan.regions) {
      const palette = palettes.get(region.id);
      expect(palette, region.id).toBeDefined();
      for (const role of ROLES) {
        expect(palette!.species(role), `${region.id}/${role}`).not.toBe('');
      }
    }
  });

  it('answers the same species every time it is asked for a role', () => {
    const plan = planDesignFor(7, HEXIA, 0.5);
    const palette = planPalettes(plan, 7).get(plan.regions[0]!.id)!;
    expect(palette.species('mass')).toBe(palette.species('mass'));
    expect(palette.species('mass')).not.toBe(palette.species('accent'));
  });

  it('is deterministic per (plan, seed)', () => {
    const plan = planDesignFor(99, HEXIA, 0.6);
    const read = (): string => [...planPalettes(plan, 99).entries()]
      .map(([id, p]) => `${id}:${p.primary}/${p.accent}/${p.species('mass')}`).join('|');
    expect(read()).toBe(read());
  });

  it('gives neighbouring regions different dominant families more often than chance', () => {
    let pairs = 0, differ = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const plan = planDesignFor(seed, HEXIA, 0.7);
      const palettes = planPalettes(plan, seed);
      for (const a of plan.regions) {
        for (const b of plan.regions) {
          if (a.id >= b.id) continue;
          const ra = a.lot[0], rb = b.lot[0];
          if (!ra || !rb) continue;
          const dx = Math.max(0, Math.max(ra.x - (rb.x + rb.w), rb.x - (ra.x + ra.w)));
          const dy = Math.max(0, Math.max(ra.y - (rb.y + rb.h), rb.y - (ra.y + ra.h)));
          if (Math.max(dx, dy) > 8) continue;
          pairs++;
          if (palettes.get(a.id)!.primary !== palettes.get(b.id)!.primary) differ++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(20);
    // Chance alone would separate about 1 - 1/families of the pairs; the operator must beat it.
    const chance = 1 - 1 / flowerFamilies().length;
    expect(differ / pairs).toBeGreaterThan(chance);
  });
});
