import type { MacroCoord, RegionCoord } from '../base/coords';
import { CHUNK_LABELS, CHUNK_SIZE } from '../game/profile';
import { TERRAIN_GRID_OFFSET } from './grid-convert';

/** A map's complete reference grid, including sea outside the saved cell rectangle. */
export interface ChunkGrid { origin: MacroCoord; columns: number; rows: number }

type ChunkMap = { width: number; height: number; chunkGrid?: ChunkGrid };
const ZERO_ORIGIN: MacroCoord = { x: 0, y: 0 };

/** Map reference regions have their own origin; renderer culling buckets stay zero-aligned. */
export function mapChunkOrigin(template: { chunkGrid?: ChunkGrid }): MacroCoord {
  return template.chunkGrid?.origin ?? ZERO_ORIGIN;
}

/** A region row's label (`CHUNK_LABELS`). */
export function chunkRowLabel(cy: number): string {
  return CHUNK_LABELS.row(cy);
}

/** A region column's label (`CHUNK_LABELS`). */
export function chunkColumnLabel(cx: number): string {
  return CHUNK_LABELS.column(cx);
}

/** A region's name, from its column and row: the labels the map draws along its edges, row first. */
export function chunkName(cx: number, cy: number): string {
  return `${chunkRowLabel(cy)}${chunkColumnLabel(cx)}`;
}

export function mapChunkAt(template: { chunkGrid?: ChunkGrid }, x: number, y: number): RegionCoord {
  const origin = mapChunkOrigin(template);
  return { cx: Math.floor((x - origin.x) / CHUNK_SIZE), cy: Math.floor((y - origin.y) / CHUNK_SIZE) } as RegionCoord;
}

interface ChunkSpan { start: number; end: number; center: number }

function chunkSpans(length: number, origin: number): ChunkSpan[] {
  const spans: ChunkSpan[] = [];
  for (let edge = origin; edge < length; edge += CHUNK_SIZE) {
    const start = edge, end = Math.min(length, edge + CHUNK_SIZE);
    spans.push({ start, end, center: (start + end) / 2 });
  }
  return spans;
}

export function mapChunkAxes(template: ChunkMap): { columns: ChunkSpan[]; rows: ChunkSpan[] } {
  const frame = mapFrame(template);
  return { columns: chunkSpans(frame.x + frame.width, frame.x), rows: chunkSpans(frame.y + frame.height, frame.y) };
}

export interface MapFrame { x: number; y: number; width: number; height: number }

/** Presentation bounds never change the saved grid's dimensions or coordinate origin. */
export function mapFrame(template: ChunkMap): MapFrame {
  const grid = template.chunkGrid;
  return grid
    ? { ...grid.origin, width: grid.columns * CHUNK_SIZE, height: grid.rows * CHUNK_SIZE }
    : { x: 0, y: 0, width: template.width, height: template.height };
}

/** The frame that captures the cells `box` covers: grown up and left by the part of its first
 *  column's and row's terrain that shows past it, where the map has terrain (from cell 0), and kept
 *  where the box already reaches past that. */
export function cellsCaptureFrame(box: MapFrame): MapFrame {
  const x = Math.min(box.x, Math.max(box.x, 0) + TERRAIN_GRID_OFFSET.x);
  const y = Math.min(box.y, Math.max(box.y, 0) + TERRAIN_GRID_OFFSET.y);
  return { x, y, width: box.x + box.width - x, height: box.y + box.height - y };
}

/** Keep terrain's half-cell bleed where the surrounding sea does not already cover it. */
export function mapCaptureFrame(template: ChunkMap): MapFrame {
  return cellsCaptureFrame(mapFrame(template));
}

/** The same cell frame as the 2D capture, so separately rendered maps, grids and annotations align. */
export interface BandGeometry {
  /** Top-left of the capture in saved cell coordinates, including surrounding sea or terrain bleed. */
  originX: number;
  originY: number;
  widthCells: number;
  heightCells: number;
}

export function bandGeometry(t: ChunkMap): BandGeometry {
  const frame = mapCaptureFrame(t);
  return { originX: frame.x, originY: frame.y, widthCells: frame.width, heightCells: frame.height };
}
