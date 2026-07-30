// chunk-cull.ts — the PURE math half of chunk culling (no Pixi import, so it unit-tests
// headlessly): the camera's world-space view rect and the chunk-AABB intersection test.
// The container plumbing lives in chunk-grid.ts.
import { TILE_SIZE, CHUNK_SIZE } from '../../../core/model/constants';

export const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;
/** Overscan beyond the viewport, in world px. A chunk is bucketed by its anchor cell, but content
 *  can spill past it (bridge spans up to ~7 cells, sprites overflow their footprint by 10%), so
 *  the view rect is padded far enough that nothing pops at the screen edge. Content that can
 *  spill FURTHER than this (the central plaza's 20×27 footprint) must not be chunk-bucketed at
 *  all — its anchor chunk can be fully outside the padded rect while its body is on screen. */
export const CULL_MARGIN_PX = 8 * TILE_SIZE;

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
