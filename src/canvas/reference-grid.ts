import { mapChunkAxes, mapFrame, type MapFrame } from '../core/model/map-chunks';
import type { MapTemplate } from '../core/model/types';
import type { PlanetFrame } from '../core/model/planet';
import { CHUNK_SIZE } from '../core/model/game-profile';

/** Screen widths use CSS pixels; cell widths keep strokes proportional at close and distant zooms. */
export const CHUNK_GRID_STYLE = {
  minCellWidth: 1 / 8,
  dashCells: 1,
  gapCells: 1,
  map2d: { widthPx: 3, opacity: 0.08 },
  map3d: { widthPx: 3, opacity: 0.24, maxCellWidth: 1 / 4 },
  /** The planet session's live frame: the same dashes, inked to be read rather than consulted. */
  planetFrame: { ink: 0x000000, opacity: 0.22 },
  /** Planet pictures (Change Planet previews, carry pictures, the save panel): the same dashes as a
   *  quiet guide the land and its rim read over. */
  planetPreview: { ink: 0x000000, opacity: 0.14, widthPx: 1.5 },
} as const;

export const CELL_GRID_STYLE = {
  subWidthPx: 0.4,
  /** `fadePx` and `subFadePx` are the on-screen cell sizes, in css px, over which the cell lines and
   *  the half-cell sub-lines fade in; the sub-lines start once the cell lines stand at full strength. */
  map2d: { widthPx: 1, opacity: 0.34, subOpacity: 0.14, fadePx: [10, 18], subFadePx: [28, 44] },
  map3d: { widthPx: 0.8, opacity: 0.24, subOpacity: 0.10, fadePx: [2, 6], subFadePx: [10, 20] },
} as const;

/** A chunk dash's width in cells for `widthPx` screen pixels at `cellPixels` a cell, held between
 *  the minimum cell width and half a dash. */
export function chunkStrokeCells(cellPixels: number, widthPx: number = CHUNK_GRID_STYLE.map2d.widthPx): number {
  return Math.min(CHUNK_GRID_STYLE.dashCells / 2, Math.max(CHUNK_GRID_STYLE.minCellWidth, widthPx / cellPixels));
}

/** Subtract only painted dashes, keeping white lines in their gaps without overlapping fills. */
export function cellGridRects(template: MapTemplate, chunkStroke = 0): MapFrame[] {
  const frame = mapFrame(template);
  if (!chunkStroke) return [frame];
  const events = new Map<number, { add: MapFrame[]; remove: MapFrame[] }>();
  const event = (y: number) => {
    let at = events.get(y);
    if (!at) { at = { add: [], remove: [] }; events.set(y, at); }
    return at;
  };
  event(frame.y); event(frame.y + frame.height);
  for (const rect of chunkGridRects(template, chunkStroke)) {
    event(rect.y).add.push(rect);
    event(rect.y + rect.height).remove.push(rect);
  }
  const ys = [...events.keys()].sort((a, b) => a - b);
  const active = new Set<MapFrame>(), rectangles: MapFrame[] = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const y = ys[i]!, height = ys[i + 1]! - y, at = events.get(y)!;
    for (const rect of at.remove) active.delete(rect);
    for (const rect of at.add) active.add(rect);
    let x = frame.x;
    for (const rect of [...active].sort((a, b) => a.x - b.x)) {
      if (rect.x > x) rectangles.push({ x, y, width: rect.x - x, height });
      x = Math.max(x, rect.x + rect.width);
    }
    const right = frame.x + frame.width;
    if (x < right) rectangles.push({ x, y, width: right - x, height });
  }
  return rectangles;
}

/** Non-overlapping rectangles keep dashed intersections at the same opacity as straight runs. */
export function chunkGridRects(template: Pick<MapTemplate, 'width' | 'height' | 'chunkGrid'>, strokeCells: number): MapFrame[] {
  const frame = mapFrame(template), axes = mapChunkAxes(template);
  const right = frame.x + frame.width, bottom = frame.y + frame.height;
  const width = Math.min(strokeCells, CHUNK_GRID_STYLE.dashCells / 2);
  const period = CHUNK_GRID_STYLE.dashCells + CHUNK_GRID_STYLE.gapCells;
  const halfDash = CHUNK_GRID_STYLE.dashCells / 2;
  const strips = (starts: number[], low: number, high: number): [number, number][] =>
    [...starts, high].map((at) => at === low ? [low, low + width] : at === high ? [high - width, high] : [at - width / 2, at + width / 2]);
  const columns = strips(axes.columns.map((span) => span.start), frame.x, right);
  const rows = strips(axes.rows.map((span) => span.start), frame.y, bottom);
  const rectangles: MapFrame[] = [];
  const add = (x: number, y: number, endX: number, endY: number): void => {
    if (endX > x && endY > y) rectangles.push({ x, y, width: endX - x, height: endY - y });
  };
  for (const [x0, x1] of columns) {
    for (let y = frame.y; y <= bottom; y += period) add(x0, Math.max(frame.y, y - halfDash), x1, Math.min(bottom, y + halfDash));
  }
  for (const [y0, y1] of rows) {
    for (let center = frame.x; center <= right; center += period) {
      let x = Math.max(frame.x, center - halfDash);
      const end = Math.min(right, center + halfDash);
      for (const [cut0, cut1] of columns) {
        if (cut1 <= x || cut0 >= end) continue;
        add(x, y0, Math.min(cut0, end), y1);
        x = Math.max(x, cut1);
      }
      add(x, y0, end, y1);
    }
  }
  return rectangles;
}

/** The chunk-bounds dashes of a planet's frame alone. */
export function planetFrameRects(frame: PlanetFrame, strokeCells: number): MapFrame[] {
  const width = frame.x0 + frame.cols * CHUNK_SIZE, height = frame.y0 + frame.rows * CHUNK_SIZE;
  return chunkGridRects({ width, height, chunkGrid: { origin: { x: frame.x0, y: frame.y0 }, columns: frame.cols, rows: frame.rows } }, strokeCells);
}
