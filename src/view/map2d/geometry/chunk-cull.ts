// The pure math of chunk culling: the camera's padded view rect and the chunk intersection test.
// The containers live in `map2d/layers/chunk-grid.ts`.
import { TILE_SIZE } from './world';
import { BUCKET_SIZE } from '../../../core/grid/buckets';
import { isLandmarkItem } from '../../../core/model/landmarks';
import { longestFootprintSide } from '../../../core/model/traits';
import { getKnownItems } from '../../../state/catalog';

export const CHUNK_PX = BUCKET_SIZE * TILE_SIZE;

/** How far a sprite may overflow its footprint, as a share of it. */
const SPRITE_OVERFLOW = 0.1;
/** The longest footprint side, in cells, of any built-in item drawn into a chunk bucket; landmark
 *  items are drawn unbucketed. Read once: the catalog is fixed after boot (only tests register
 *  items later). */
const LONGEST_BUCKETED_SIDE = Math.max(1, ...getKnownItems().filter((item) => !isLandmarkItem(item.id)).map(longestFootprintSide));
/** Overscan beyond the viewport, in world px. Content is bucketed by its anchor cell and spills
 *  past it by up to the longest bucketed footprint plus its sprite overflow, so the view rect is
 *  padded that far. Content that spills further is never bucketed, since its anchor chunk can be
 *  outside the padded rect while its body is on screen. */
export const CULL_MARGIN_PX = Math.ceil(LONGEST_BUCKETED_SIDE * (1 + SPRITE_OVERFLOW)) * TILE_SIZE;

export interface CullRect { left: number; top: number; right: number; bottom: number }

/** The world-space view rect (+ overscan margin) for a camera at `offset`/`zoom` over a
 *  `screenW`×`screenH` canvas — screen corners mapped through world = (screen + offset) / zoom. */
export function cullRect(offsetX: number, offsetY: number, zoom: number, screenW: number, screenH: number): CullRect {
  return {
    left: offsetX / zoom - CULL_MARGIN_PX,
    top: offsetY / zoom - CULL_MARGIN_PX,
    right: (screenW + offsetX) / zoom + CULL_MARGIN_PX,
    bottom: (screenH + offsetY) / zoom + CULL_MARGIN_PX,
  };
}

/** Whether chunk (cx, cy) — a CHUNK_PX square at (cx·CHUNK_PX, cy·CHUNK_PX) — intersects `rect`. */
export function chunkVisible(cx: number, cy: number, rect: CullRect): boolean {
  const x0 = cx * CHUNK_PX, y0 = cy * CHUNK_PX;
  return x0 < rect.right && x0 + CHUNK_PX > rect.left && y0 < rect.bottom && y0 + CHUNK_PX > rect.top;
}
