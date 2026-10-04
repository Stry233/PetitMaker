import { ItemCategory, type CatalogItem, type PlacementTrait } from './types';

/** Whether a catalog item carries a placement trait of the given type. The ONE shared
 *  predicate for `item.traits.some(t => t.type === ...)` (re-implemented across rules,
 *  tools, edge-cut, renderer) — keep the open-coded form out of higher layers. */
export const hasTrait = (item: CatalogItem, type: PlacementTrait['type']): boolean =>
  item.traits.some(t => t.type === type);

/** Whether an item is a surface coating (a road/path) — coated OVER terrain, never a blocker. */
export const isCoating = (item: CatalogItem): boolean => hasTrait(item, 'surfaceCoating');

/** The trait variant of the given type. */
export type TraitOf<T extends PlacementTrait['type']> = Extract<PlacementTrait, { type: T }>;

/** The item's trait of the given type, typed to that variant, or undefined. */
export function findTrait<T extends PlacementTrait['type']>(
  item: { readonly traits: readonly PlacementTrait[] } | undefined | null, type: T,
): TraitOf<T> | undefined {
  return item?.traits.find((t): t is TraitOf<T> => t.type === type);
}

// Behaviour asks these predicates; ItemCategory remains the shelf grouping and the item pools drawn from it.

/** Whether the item is a surface coating; false for a missing item. */
export const isCoatingItem = (item: CatalogItem | undefined | null): boolean => !!item && isCoating(item);

/** Whether the item spans water between two flat ends (`waterSpan`). */
export const isBridge = (item: CatalogItem | undefined | null): boolean => !!item && hasTrait(item, 'waterSpan');

/** Whether the item climbs between two levels (`heightDrop`). */
export const isRamp = (item: CatalogItem | undefined | null): boolean => !!item && hasTrait(item, 'heightDrop');

/** Whether the item is a crossing: a bridge or a ramp, which detects its own site and may stand over coatings. */
export const isCrossing = (item: CatalogItem | undefined | null): boolean => isBridge(item) || isRamp(item);

/** The layers a ramp climbs (its `heightDrop`), 1 for an item without one. */
export const rampDropLayers = (item: CatalogItem | undefined | null): number => findTrait(item, 'heightDrop')?.layers ?? 1;

/** Whether `item` may STAND ON the coating instead of stripping it or violating the
 *  standing-on-a-road rule: flora on a `plantable` coating, the game's plantable road. The ONE
 *  answer the placer's strip, the overlap rule and V-PLACE-COATED all read, so the three cannot
 *  disagree about a pair. */
export const standsOnCoating = (item: CatalogItem | undefined | null, coating: CatalogItem): boolean =>
  !!item && item.category === ItemCategory.Flora && hasTrait(coating, 'plantable');
