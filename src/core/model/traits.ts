import type { CatalogItem, PlacementTrait } from './types';

/** Whether a catalog item carries a placement trait of the given type. The ONE shared
 *  predicate for `item.traits.some(t => t.type === ...)` (re-implemented across rules,
 *  tools, edge-cut, renderer) — keep the open-coded form out of higher layers. */
export const hasTrait = (item: CatalogItem, type: PlacementTrait['type']): boolean =>
  item.traits.some(t => t.type === type);

/** Whether an item is a surface coating (a road/path) — coated OVER terrain, never a blocker. */
export const isCoating = (item: CatalogItem): boolean => hasTrait(item, 'surfaceCoating');
