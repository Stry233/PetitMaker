// Stage 1 of the methodology generator: the region LIST. The hard rule the PDF states first is that
// every building is placed, so the load-bearing test is that the anchor regions cover every
// placeable Building and Facility exactly once, on every seed. The rest pins what richness is
// allowed to change (the theme COUNT, monotonically) and what it is not (the anchor set).
import { describe, it, expect } from 'vitest';
import { ItemCategory } from '../../../../../core/model/types';
import { getPlaceableByCategory } from '../../../../../state/catalog';
import { anchorCatalogIds } from '../../../../../tools/generation/designer/eval';
import {
  ANCHOR_ROLES, THEME_LIBRARY, THEME_COUNT, anchorCatalogItems, anchorRoleOf, planRegionList,
  themeCount,
} from '../../../../../tools/generation/designer/places/region-list';

const SEEDS = Array.from({ length: 20 }, (_, i) => 1 + i * 7919);

describe('the anchor set', () => {
  it('covers every placeable building and facility exactly once, on every seed', () => {
    const required = [...anchorCatalogIds()].sort();
    for (const seed of SEEDS) {
      for (const richness of [0, 0.5, 1]) {
        const list = planRegionList(seed, undefined, richness);
        const placed = list.flatMap((r) => r.anchors);
        expect(new Set(placed).size, `seed ${seed}: an item is assigned twice`).toBe(placed.length);
        expect([...placed].sort(), `seed ${seed} richness ${richness}`).toEqual(required);
      }
    }
  });

  it('gives every anchor region a kind, and theme regions none of the buildings', () => {
    const list = planRegionList(42);
    for (const r of list) {
      if (r.kind === 'theme') {
        expect(r.anchors).toEqual([]);
        expect(r.themeId).toBeDefined();
      } else {
        expect(r.anchors.length).toBeGreaterThan(0);
        expect(r.themeId).toBeUndefined();
        expect(r.minSize).toBeDefined();
      }
    }
    expect(list.some((r) => r.kind === 'own-house')).toBe(true);
    expect(list.some((r) => r.kind === 'museum')).toBe(true);
    expect(list.some((r) => r.kind === 'shop')).toBe(true);
  });

  // ONE HOME, ONE REGION. Gathering homes into clusters of two to four is a fair reading of the PDF's
  // 住宅区 and not what either reference map does: every one of the style target's twelve buildings
  // stands in a neighbourhood of its own. A region per home is what gives each its own palette and its
  // own composed surroundings, and what lets the layout spread them across the planet.
  it('gives every home its own region', () => {
    for (const seed of SEEDS) {
      const homes = planRegionList(seed).filter((x) => x.kind === 'residential');
      for (const r of homes) expect(r.anchors.length, `seed ${seed}`).toBe(1);
      const ids = homes.flatMap((r) => r.anchors);
      expect(new Set(ids).size, `seed ${seed}: distinct homes`).toBe(ids.length);
    }
  });

  // A catalog item with no row falls back by category, which is correct but silent. This is the
  // drift guard: a new Building or Facility should get a row saying which anchor it belongs to.
  it('has a mapping row for every placeable building and facility', () => {
    const rows = new Set(ANCHOR_ROLES.map((r) => r.id));
    for (const item of anchorCatalogItems()) expect(rows.has(item.id), item.id).toBe(true);
  });

  it('routes the museum stand-in and the shop to their own anchors', () => {
    const pavilion = getPlaceableByCategory(ItemCategory.Facility).find((i) => i.id === 'facility-pavilion');
    const shop = getPlaceableByCategory(ItemCategory.Facility).find((i) => i.id === 'facility-shop');
    expect(pavilion && anchorRoleOf(pavilion)).toBe('museum');
    expect(shop && anchorRoleOf(shop)).toBe('shop');
  });
});

describe('the theme draw', () => {
  it('scales the count with richness, monotonically', () => {
    let previous = -1;
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const richness = Math.min(1, r);
      const n = planRegionList(4242, undefined, richness).filter((x) => x.kind === 'theme').length;
      expect(n).toBe(themeCount(richness));
      expect(n, `richness ${richness}`).toBeGreaterThanOrEqual(previous);
      previous = n;
    }
    expect(themeCount(0)).toBe(THEME_COUNT.min);
    expect(themeCount(1)).toBe(THEME_COUNT.max);
  });

  it('never repeats a theme on one map', () => {
    for (const seed of SEEDS) {
      const themes = planRegionList(seed, undefined, 1).map((r) => r.themeId).filter(Boolean);
      expect(new Set(themes).size, `seed ${seed}`).toBe(themes.length);
    }
  });

  it('draws only from the library, and gates the landmark region on richness', () => {
    const known = new Set(THEME_LIBRARY.map((t) => t.id));
    for (const seed of SEEDS) {
      for (const richness of [0, 0.4, 0.6, 1]) {
        for (const r of planRegionList(seed, undefined, richness)) {
          if (!r.themeId) continue;
          expect(known.has(r.themeId)).toBe(true);
          if (r.themeId === 'landmark-text') expect(richness).toBeGreaterThanOrEqual(0.6);
        }
      }
    }
  });

  it('draws a partner for the cases that need one', () => {
    for (const seed of SEEDS) {
      const list = planRegionList(seed, undefined, 0.6);
      // Case 6 wants a library for the shop, and the shop is always on the map.
      expect(list.some((r) => r.tags.includes('library')), `seed ${seed}`).toBe(true);
      // Case 1 wants greenery for a drink region, where one was drawn.
      if (list.some((r) => r.tags.includes('drink'))) {
        expect(list.some((r) => r.tags.includes('greenery')), `seed ${seed}`).toBe(true);
      }
    }
  });
});

describe('determinism', () => {
  it('answers the same list for the same seed and richness', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      expect(planRegionList(seed, undefined, 0.7)).toEqual(planRegionList(seed, undefined, 0.7));
    }
  });

  it('answers differently for different seeds', () => {
    const a = JSON.stringify(planRegionList(1, undefined, 0.7));
    const b = JSON.stringify(planRegionList(2, undefined, 0.7));
    expect(a).not.toBe(b);
  });
});
