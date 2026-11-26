/** How a piece of a Letter or Picture stands in a plan facing another way: the generator and the
 *  load budget both read it here, so a planned piece and a laid one share one turn and footprint. */
import { getRotatedSize } from '../../../core/grid/footprint';
import type { Rotation } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';

/** The turn a piece takes in a picture facing `facing`: the facing itself for an item that turns,
 *  none for one that never does, as a group turn decides it. */
export function pieceTurn(facing: Rotation | undefined, catalogId: string): Rotation {
  return facing && getCatalogItem(catalogId)?.rotatable ? facing : 0;
}

/** The cells a piece covers at that turn, at least one each way. */
export function pieceSize(facing: Rotation | undefined, catalogId: string): { w: number; h: number } {
  const item = getCatalogItem(catalogId);
  if (!item) return { w: 1, h: 1 };
  const size = getRotatedSize(item, pieceTurn(facing, catalogId));
  return { w: Math.max(1, size.w), h: Math.max(1, size.h) };
}
