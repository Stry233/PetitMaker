import type { CatalogItem } from '../../core/model/types';
import type { RoadMaterialSpec, RoadVectorPattern, RoadImagePattern } from './road-material';

/** A catalog item as the catalog ships it: the kernel's `CatalogItem` plus the fields only the
 *  renderers, the picture engines and the shelf search read. */
export interface CatalogEntry extends CatalogItem {
  /**
   * The colour this item's sprite reads as, derived from the shipped PNG rather than authored: the mean
   * of its mid-luminance opaque pixels, which is what `view/shared/icon/icon-sampling.ts` samples at runtime.
   *
   * Derived data, and the project's colour-extraction tooling is its one writer (its own drift check fails on
   * drift). It is committed because a colour that needs a canvas to read cannot be answered where there
   * is no canvas: the picture generator matches a picture's colours against a palette of items, and it
   * runs in a worker and in the offline benchmark as well as on a page. Unlike `color` it does not mean
   * "draw this item as a flat colour" — an item with a sprite is drawn as its sprite.
   */
  iconColor?: string;
  /** Base colour (`#rrggbb`) of the 2D footprint gradient for an item drawn as one (ramps): the hue
   *  names the item, the light-to-dark run its slope. Absent draws the neutral default. */
  footprintColor?: string;
  /** Boundary-following surface material; omitted surfaces repeat their catalog icon. */
  roadMaterial?: RoadMaterialSpec;
  /** Transparent, per-cell artwork above pavement, with the placed object's rotation. */
  surfacePrint?: RoadVectorPattern | RoadImagePattern;
  /** Other names the shelf's search should answer to: common alternate names, nicknames, material
   *  or colour words a person would actually type, mixed en/zh (or any locale) in one list, since
   *  search already crosses locales. Authored per item in its own JSON, not derived. */
  aliases?: string[];
}
