// What the illustration calls a placed item: its category's stylize word (building, road, plant),
// or nothing. The prompt's present-category clauses, the scene's clusters and the layout legend
// all read it, so they agree about which items are buildings.
import type { CatalogItem } from '../../../core/model/types';
import { CATEGORY_BY_ID, type CategoryEntry } from '../../../config/catalog/categories';

export type PlacedElement = NonNullable<CategoryEntry['stylizeLabel']>;

/** `item`'s stylize element, or null for an unknown item or a category the illustration names not. */
export function stylizeElementOf(item: Pick<CatalogItem, 'category'> | undefined | null): PlacedElement | null {
  return (item && CATEGORY_BY_ID.get(item.category)?.stylizeLabel) ?? null;
}
