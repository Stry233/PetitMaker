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
 * `catalog-order.test.ts` holds every entry resolvable against the live catalog, and holds the
 * historical prefix fixed.
 *
 * A RETIRED id keeps its slot and no longer names a catalog item (`io/legacy-catalog.ts` says what
 * each one reads as). Its index still has to resolve, and it still has to resolve to the same NAME:
 * the content hash covers the ids the decoder produced, so a code written before the retirement
 * verifies only if the decoder hands back what was encoded. The substitution happens later, where
 * the decoded save becomes a GridState.
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
  'road-dirt',   // retired
  'road-stone',  // retired
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
  // — road surfaces added after that release, all four road ids retired since —
  'road-brick',
  'road-slate',
  // — the 25 in-game path surfaces, in the road barrel's authored order —
  'path-blue-board',
  'path-classic-basketweave-brick',
  'path-classic-mosaic-brick',
  'path-cobblestone',
  'path-diamond-mosaic-brick',
  'path-fan-shaped-brick',
  'path-green-board',
  'path-herringbone-clay-brick',
  'path-park-stone',
  'path-pink-board',
  'path-yellow-board',
  'path-floral-brick',
  'path-garden-stone',
  'path-geometric-terracotta',
  'path-lattice-red-brick',
  'path-overgrown-dirt',
  'path-patterned-tile',
  'path-radiant-star-stone',
  'path-retro-block',
  'path-seaside-wave',
  'path-simple-brick',
  'path-simple-flowerbed',
  'path-square-brick',
  'path-urban-asphalt',
  'path-wavy-terracotta',
];

/** How many entries the index can address. */
export const SHARE_CATALOG_LIMIT = 256;
