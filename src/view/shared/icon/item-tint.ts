import type { CategoryId } from '../../../core/model/types';
import { CATEGORY_BY_ID } from '../../../config/catalog/categories';
import { hexStringToNumber } from '../../../core/base/color';

/** The tint of an item no colour and no category names. */
export const FALLBACK_TINT = 0xfb923c;

/** A catalog item's tint as `0xrrggbb` when nothing more specific colours it: its own colour (roads
 *  carry one), else its category's tint, else the global fallback. Both views end every object
 *  tint with this, so a poof and a 3D body pick the same hue. */
export function itemTint(item: { category: CategoryId; color?: string } | undefined): number {
  if (item?.color) return hexStringToNumber(item.color);
  return (item && CATEGORY_BY_ID.get(item.category)?.tint) ?? FALLBACK_TINT;
}
