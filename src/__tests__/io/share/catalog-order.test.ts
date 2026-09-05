// Object catalog indices in share payloads are stable wire identities.
import { describe, it, expect } from 'vitest';
import { SHARE_CATALOG_ORDER, SHARE_CATALOG_LIMIT } from '../../../io/share/codec/catalog-order';
import { RETIRED_CATALOG_IDS, currentCatalogId } from '../../../io/legacy-catalog';
import { getAllItems, getCatalogItem } from '../../../state/catalog';

const WIRE_PREFIX = [
  'bridge-iron', 'bridge-light-wood', 'bridge-park-arch', 'bridge-plank', 'bridge-retro-arch',
  'bridge-suspension', 'bridge-teak', 'building-bamboo-cabin', 'building-boat-cabin',
  'building-fluorite-cabin', 'building-forest-cabin', 'building-myhouse', 'building-plush-cabin',
  'building-stall', 'building-starbay-cabin', 'building-sunset-cabin', 'building-wave-cabin',
  'facility-pavilion', 'facility-shop', 'facility-station', 'flower-agapanthus',
  'flower-amaryllis', 'flower-bellflower', 'flower-canna-red', 'flower-canna-yellow',
  'flower-dahlia', 'flower-daisy', 'flower-lily', 'flower-portulaca-purple',
  'flower-portulaca-white', 'flower-portulaca-yellow', 'flower-protea', 'flower-protea-purple',
  'flower-protea-red', 'flower-rose', 'flower-sunflower', 'flower-violet', 'plant-agave',
  'plant-azalea', 'plant-gardenia', 'ramp-green-steps', 'ramp-light-stair', 'ramp-moss-ramp',
  'ramp-park-steps', 'ramp-plank', 'ramp-retro-steps', 'ramp-teak-stair', 'road-dirt',
  'road-stone', 'shrub', 'tree-apple', 'tree-avocado', 'tree-bamboo', 'tree-baobab',
  'tree-cactus', 'tree-dragonblood', 'tree-fir', 'tree-flame', 'tree-ginkgo', 'tree-mango',
  'tree-peach', 'tree-plum',
];

describe('share catalog wire order', () => {
  it('keeps the wire prefix at its fixed indices', () => {
    expect(SHARE_CATALOG_ORDER.slice(0, WIRE_PREFIX.length)).toEqual(WIRE_PREFIX);
  });

  it('names every catalog item, and nothing else a reader cannot resolve', () => {
    const live = getAllItems().map((i) => i.id);
    const resolvable = SHARE_CATALOG_ORDER.map(currentCatalogId);
    expect([...new Set(resolvable)].sort()).toEqual([...live].sort());
  });

  it('gives every retired id a replacement that exists, and no item of its own', () => {
    for (const [retired, replacement] of Object.entries(RETIRED_CATALOG_IDS)) {
      expect(SHARE_CATALOG_ORDER, `${retired} lost its slot`).toContain(retired);
      expect(getCatalogItem(retired), `${retired} is still in the catalog`).toBeUndefined();
      expect(getCatalogItem(replacement), `${replacement} is not a catalog item`).toBeTruthy();
    }
  });

  it('lists each id once', () => {
    expect(new Set(SHARE_CATALOG_ORDER).size).toBe(SHARE_CATALOG_ORDER.length);
  });

  it('stays inside the index width', () => {
    expect(SHARE_CATALOG_ORDER.length).toBeLessThanOrEqual(SHARE_CATALOG_LIMIT);
  });

  it('appends new items rather than sorting them in', () => {
    const idx = (id: string) => SHARE_CATALOG_ORDER.indexOf(id);
    for (const id of WIRE_PREFIX) {
      expect(idx(id), `${id} moved`).toBe(WIRE_PREFIX.indexOf(id));
    }
  });
});
