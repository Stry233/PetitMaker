import type { ChunkCoord, MacroCoord, MapTemplate } from './types';
import { CHUNK_SIZE } from './game-profile';

type ChunkMap = Pick<MapTemplate, 'width' | 'height' | 'chunkGrid'>;
const ZERO_ORIGIN: MacroCoord = { x: 0, y: 0 };

/** Map reference regions have their own origin; renderer culling buckets stay zero-aligned. */
export function mapChunkOrigin(template: Pick<MapTemplate, 'chunkGrid'>): MacroCoord {
  return template.chunkGrid?.origin ?? ZERO_ORIGIN;
}

/**
 * A region's name, from its column and row: rows are A, B, C from the top and columns 1, 2, 3 from
 * the left, the labels the map draws along its edges and the game uses. Rows wrap at Z.
 */
export function chunkName(cx: number, cy: number): string {
  return `${String.fromCharCode(65 + (cy % 26))}${cx + 1}`;
}

export function mapChunkAt(template: Pick<MapTemplate, 'chunkGrid'>, x: number, y: number): ChunkCoord {
  const origin = mapChunkOrigin(template);
  return { cx: Math.floor((x - origin.x) / CHUNK_SIZE), cy: Math.floor((y - origin.y) / CHUNK_SIZE) };
}

export interface ChunkSpan { start: number; end: number; center: number }

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

/** Keep terrain's half-cell bleed where the surrounding sea does not already cover it. */
export function mapCaptureFrame(template: ChunkMap): MapFrame {
  const frame = mapFrame(template);
  const x = Math.min(frame.x, -0.5), y = Math.min(frame.y, -0.5);
  return { x, y, width: frame.x + frame.width - x, height: frame.y + frame.height - y };
}
