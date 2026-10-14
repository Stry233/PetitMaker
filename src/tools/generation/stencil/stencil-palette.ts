/** Catalog colors keep image matching identical in the browser and generation workers. */
import type { CatalogEntry } from '../../../config/catalog/catalog-entry';
import { hexStringToNumber } from '../../../core/base/color';
import { getAllItems, itemRole } from '../../../state/catalog';
import { tilesAShape } from './stencil';
import { isCoating, isSurfacePrint } from '../../../core/model/traits';

/** Mixed mosaics omit trees so their height cannot obscure neighboring flowers. */
export type ObjectPaletteKind = 'mixed' | 'flora' | 'trees' | 'roads';

/** One entry of a colour palette: the item to place, and the colour it reads as. */
export interface ColorEntry { catalogId: string; rgb: number }

/** Mosaic cells require single-cell items without a per-map count limit. */
export function paletteItems(material: ObjectPaletteKind): CatalogEntry[] {
  const single = (i: CatalogEntry): boolean => i.width === 1 && i.height === 1 && i.maxCount === undefined;
  const all = getAllItems();
  // Transparent overlays cannot supply the complete color of a mosaic cell.
  if (material === 'roads') return all.filter((i) => isCoating(i) && !isSurfacePrint(i) && single(i));
  const usable = all.filter((i) => tilesAShape(i) && single(i));
  if (material === 'flora') return usable.filter((i) => itemRole(i) === 'groundcover');
  if (material === 'trees') return usable.filter((i) => itemRole(i) === 'canopy');
  return usable.filter((i) => itemRole(i) !== 'canopy');
}

/** Painted surface colors take precedence over colors derived from catalog icons. */
function itemColor(item: CatalogEntry): number | null {
  const hex = item.color ?? item.iconColor;
  return hex ? hexStringToNumber(hex) : null;
}

/** Items lacking both a surface color and an icon color cannot participate in color matching. */
export function declaredColorPalette(material: ObjectPaletteKind): ColorEntry[] {
  const out: ColorEntry[] = [];
  for (const item of paletteItems(material)) {
    const rgb = itemColor(item);
    if (rgb === null) continue;
    out.push({ catalogId: item.id, rgb });
  }
  return out;
}
