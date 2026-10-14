/** How a composition too large for one canvas is cut into the tiles `banded.ts` paints. */
import type { CanvasLimits } from './sizing';

export interface TilePlan {
  cols: Array<{ x: number; w: number }>;
  rows: Array<{ y: number; h: number }>;
}

/** Rows per band at most: a 10848 px wide band this tall reads back as 44 MB of pixels. */
const BAND_ROWS_MAX = 1024;

/** Columns as wide as the longest side allows, bands as tall as the area then leaves. */
export function planTiles(width: number, height: number, limits: CanvasLimits, maxRows = BAND_ROWS_MAX): TilePlan {
  const tileW = Math.max(1, Math.min(width, Math.floor(limits.maxDim)));
  const tileH = Math.max(1, Math.min(height, maxRows, Math.floor(limits.maxDim), Math.floor(limits.maxArea / tileW)));
  const cols: TilePlan['cols'] = [];
  for (let x = 0; x < width; x += tileW) cols.push({ x, w: Math.min(tileW, width - x) });
  const rows: TilePlan['rows'] = [];
  for (let y = 0; y < height; y += tileH) rows.push({ y, h: Math.min(tileH, height - y) });
  return { cols, rows };
}
