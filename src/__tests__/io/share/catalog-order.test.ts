// The share format stores an object's catalog item as an INDEX. This file is what makes that
// index mean the same item tomorrow as it does today: it holds the wire order and the live
// catalog in agreement, and holds the shipped prefix fixed.
import { describe, it, expect } from 'vitest';
import { SHARE_CATALOG_ORDER, SHARE_CATALOG_LIMIT } from '../../../io/share/codec/catalog-order';
import { getAllItems } from '../../../state/catalog';

/**
 * The order as the first PetitGlyph v2 release shipped it. Every share image made before a later
 * item existed resolves its indices through this prefix, so these 62 entries stay where they are,
 * in this sequence. A new item appends after them.
 */
const RELEASED_PREFIX = [
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
  it('keeps the released prefix exactly where it shipped', () => {
    expect(SHARE_CATALOG_ORDER.slice(0, RELEASED_PREFIX.length)).toEqual(RELEASED_PREFIX);
  });

  it('names every catalog item, and nothing else', () => {
    // An item missing here cannot be shared at all (indexOf returns -1, which the encoder would
    // write as garbage); a name here with no item behind it would decode to nothing.
    const live = getAllItems().map((i) => i.id).sort();
    expect([...SHARE_CATALOG_ORDER].sort()).toEqual(live);
  });

  it('lists each id once', () => {
    expect(new Set(SHARE_CATALOG_ORDER).size).toBe(SHARE_CATALOG_ORDER.length);
  });

  it('stays inside the index width', () => {
    expect(SHARE_CATALOG_ORDER.length).toBeLessThanOrEqual(SHARE_CATALOG_LIMIT);
  });

  it('appends new items rather than sorting them in', () => {
    // Sorting is what renumbers: an id that sorts into the middle would displace everything after
    // it. Past the released prefix the list is in ADDITION order, so it is not sorted overall
    // unless every later id happens to sort last — assert the invariant that matters instead.
    const idx = (id: string) => SHARE_CATALOG_ORDER.indexOf(id);
    for (const id of RELEASED_PREFIX) {
      expect(idx(id), `${id} moved`).toBe(RELEASED_PREFIX.indexOf(id));
    }
  });
});
