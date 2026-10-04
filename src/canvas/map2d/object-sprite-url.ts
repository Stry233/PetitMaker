/*
 * Which image a placed object draws with, as a pure lookup.
 *
 * Split out of the object layer so a caller that only needs the URL (the Help figures' ghost, a
 * capture's decode list) can ask without loading Pixi: the layer module's import graph carries the
 * whole renderer, and this answer is plain catalog arithmetic.
 */
import type { CatalogItem, PlacedObject } from '../../core/model/types';
import { iconUrl } from '../../assets/icon-urls';
import { isRamp } from '../../core/model/traits';

/** The sprite url `obj` draws with: its own variant icon, or the item's — except a color-carrying
 *  non-ramp item, whose body is drawn as geometry rather than a sprite. */
export function objectSpriteUrl(obj: PlacedObject, item: CatalogItem | undefined): string | undefined {
  const name = obj.icon ?? (isRamp(item) || !item?.color ? item?.icon : undefined);
  return name ? iconUrl(name) : undefined;
}
