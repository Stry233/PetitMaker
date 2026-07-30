/**
 * Chunk invalidation for the 3D editor's incremental remesh. A cell's mesh
 * depends on its 4-neighborhood (exposed-face culling, cut backing, silhouette
 * tiers all read adjacent cells), so an edit dirties the chunks covering the
 * changed cells expanded by one cell in every direction.
 */
import { CHUNK_SIZE } from '../../../core/model/constants';
import type { MacroCoord } from '../../../core/model/types';

export function dirtyChunksFor(cells: readonly MacroCoord[], mapWidth: number, mapHeight: number): Set<string> {
  const maxCx = Math.ceil(mapWidth / CHUNK_SIZE) - 1;
  const maxCy = Math.ceil(mapHeight / CHUNK_SIZE) - 1;
  const out = new Set<string>();
  for (const { x, y } of cells) {
    const cx0 = Math.max(0, Math.floor((x - 1) / CHUNK_SIZE));
    const cx1 = Math.min(maxCx, Math.floor((x + 1) / CHUNK_SIZE));
    const cy0 = Math.max(0, Math.floor((y - 1) / CHUNK_SIZE));
    const cy1 = Math.min(maxCy, Math.floor((y + 1) / CHUNK_SIZE));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) out.add(`${cx},${cy}`);
    }
  }
  return out;
}
