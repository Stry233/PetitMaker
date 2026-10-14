/**
 * Chunk invalidation for the 3D editor's incremental remesh. A cell's mesh
 * depends on its 4-neighborhood (exposed-face culling, cut backing, silhouette
 * tiers all read adjacent cells), so an edit dirties the chunks covering the
 * changed cells expanded by one cell in every direction.
 */
import type { MacroCoord } from '../../../core/model/types';
import { bucketOf, bucketCounts } from '../../../core/grid/buckets';
import { chunkKey } from '../../../core/grid/rect';

export function dirtyChunksFor(cells: readonly MacroCoord[], mapWidth: number, mapHeight: number): Set<string> {
  const { cols, rows } = bucketCounts(mapWidth, mapHeight);
  const maxCx = cols - 1, maxCy = rows - 1;
  const out = new Set<string>();
  for (const { x, y } of cells) {
    const lo = bucketOf(x - 1, y - 1), hi = bucketOf(x + 1, y + 1);
    const cx0 = Math.max(0, lo.cx), cx1 = Math.min(maxCx, hi.cx);
    const cy0 = Math.max(0, lo.cy), cy1 = Math.min(maxCy, hi.cy);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) out.add(chunkKey(cx, cy));
    }
  }
  return out;
}
