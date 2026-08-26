import { ItemCategory, type CatalogItem, type PlacementTrait } from './types';

/** Whether a catalog item carries a placement trait of the given type. The ONE shared
 *  predicate for `item.traits.some(t => t.type === ...)` (re-implemented across rules,
 *  tools, edge-cut, renderer) — keep the open-coded form out of higher layers. */
export const hasTrait = (item: CatalogItem, type: PlacementTrait['type']): boolean =>
  item.traits.some(t => t.type === type);

/** Whether an item is a surface coating (a road/path) — coated OVER terrain, never a blocker. */
export const isCoating = (item: CatalogItem): boolean => hasTrait(item, 'surfaceCoating');

/** Whether `item` may STAND ON the coating instead of stripping it or violating the
 *  standing-on-a-road rule: flora on a `plantable` coating, the game's plantable road. The ONE
 *  answer the placer's strip, the overlap rule and V-PLACE-COATED all read, so the three cannot
 *  disagree about a pair. */
export const standsOnCoating = (item: CatalogItem | undefined | null, coating: CatalogItem): boolean =>
  !!item && item.category === ItemCategory.Flora && hasTrait(coating, 'plantable');
