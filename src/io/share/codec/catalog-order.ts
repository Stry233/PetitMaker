/**
 * The catalog's WIRE ORDER: the index a share code stores for an object's `catalogId`.
 *
 * APPEND ONLY. A position in this list is part of the share format — a code written today says
 * "item 34", and the reader has to resolve that to the same item forever. Inserting, removing or
 * reordering an entry renumbers every entry after it, which turns previously-shared images into
 * different maps (the payload's content hash then rejects them, so they fail to import rather
 * than decode wrongly, but they are lost either way).
 *
 * A new catalog item goes at the END, whatever its id sorts to and whatever category it joins.
 * `catalog-order.test.ts` holds this list and the live catalog in agreement, and holds the
 * historical prefix fixed.
 *
 * The index is written with an 8-bit tree model, so this list may hold at most 256 entries.
 * The width costs about 0.2% of a full map's code and buys headroom the catalog will need.
 */
export const SHARE_CATALOG_ORDER: readonly string[] = [
  // — the 62 items of the first PetitGlyph v2 release, in the order that format shipped —
  'bridge-iron',
  'bridge-light-wood',
  'bridge-park-arch',
  'bridge-plank',
  'bridge-retro-arch',
  'bridge-suspension',
  'bridge-teak',
  'building-bamboo-cabin',
  'building-boat-cabin',
  'building-fluorite-cabin',
  'building-forest-cabin',
  'building-myhouse',
  'building-plush-cabin',
  'building-stall',
  'building-starbay-cabin',
  'building-sunset-cabin',
  'building-wave-cabin',
  'facility-pavilion',
  'facility-shop',
  'facility-station',
  'flower-agapanthus',
  'flower-amaryllis',
  'flower-bellflower',
  'flower-canna-red',
  'flower-canna-yellow',
  'flower-dahlia',
  'flower-daisy',
  'flower-lily',
  'flower-portulaca-purple',
  'flower-portulaca-white',
  'flower-portulaca-yellow',
  'flower-protea',
  'flower-protea-purple',
  'flower-protea-red',
  'flower-rose',
  'flower-sunflower',
  'flower-violet',
  'plant-agave',
  'plant-azalea',
  'plant-gardenia',
  'ramp-green-steps',
  'ramp-light-stair',
  'ramp-moss-ramp',
  'ramp-park-steps',
  'ramp-plank',
  'ramp-retro-steps',
  'ramp-teak-stair',
  'road-dirt',
  'road-stone',
  'shrub',
  'tree-apple',
  'tree-avocado',
  'tree-bamboo',
  'tree-baobab',
  'tree-cactus',
  'tree-dragonblood',
  'tree-fir',
  'tree-flame',
  'tree-ginkgo',
  'tree-mango',
  'tree-peach',
  'tree-plum',
  // — flower colourways added after that release —
  'flower-daisy-yellow',
  'flower-daisy-cyan',
  'flower-sunflower-red',
  'flower-sunflower-green',
  'flower-canna-gold',
  'flower-dahlia-orange',
  'flower-dahlia-cyan',
  'flower-amaryllis-white',
  'flower-amaryllis-orange',
  'flower-bellflower-cyan',
  'flower-bellflower-yellow',
  'flower-violet-pink',
  'flower-violet-cyan',
  'flower-lily-yellow',
  'flower-lily-cyan',
  'flower-agapanthus-white',
  'flower-agapanthus-blue',
  'flower-rose-cyan',
  'flower-rose-blue',
];

/** How many entries the index can address. */
export const SHARE_CATALOG_LIMIT = 256;
