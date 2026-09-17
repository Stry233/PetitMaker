/**
 * The 2D map as an export source captured region by region: a map at native resolution is larger
 * than any texture or canvas the device holds, so each tile is rendered on demand into the part of
 * the composition being painted.
 */
import type { Rect } from './types';
import type { BandWindow } from './banded';

/** A region in the map frame's own pixels, origin at the frame's top-left. */
export interface RegionPx { x: number; y: number; w: number; h: number }

export class TiledMap {
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly capture: (region: RegionPx) => CanvasImageSource | null,
    /** Longest tile side the renderer can bake. */
    private readonly maxTile: number,
  ) {}

  /** Draws the map fitted into `dest`, limited to what `window` shows, tile by tile. */
  draw(ctx: CanvasRenderingContext2D, dest: Rect, window?: BandWindow): void {
    const scale = dest.w / this.width;
    const left = window ? Math.max(dest.x, window.left) : dest.x;
    const top = window ? Math.max(dest.y, window.top) : dest.y;
    const right = window ? Math.min(dest.x + dest.w, window.right) : dest.x + dest.w;
    const bottom = window ? Math.min(dest.y + dest.h, window.bottom) : dest.y + dest.h;
    if (right <= left || bottom <= top) return;
    const sx0 = Math.max(0, Math.floor((left - dest.x) / scale));
    const sy0 = Math.max(0, Math.floor((top - dest.y) / scale));
    const sx1 = Math.min(this.width, Math.ceil((right - dest.x) / scale));
    const sy1 = Math.min(this.height, Math.ceil((bottom - dest.y) / scale));
    for (let y = sy0; y < sy1; y += this.maxTile) {
      const h = Math.min(this.maxTile, sy1 - y);
      for (let x = sx0; x < sx1; x += this.maxTile) {
        const w = Math.min(this.maxTile, sx1 - x);
        const tile = this.capture({ x, y, w, h });
        if (tile) ctx.drawImage(tile, 0, 0, w, h, dest.x + x * scale, dest.y + y * scale, w * scale, h * scale);
      }
    }
  }
}
