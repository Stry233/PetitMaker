/**
 * The pure plan for one chunk of the layer-number overlay: which cells inside
 * the chunk show which elevation label. The raster painter stays a thin canvas
 * loop over this; the masking rules (object footprints, hidden layers, ground
 * island cells) live here where they can be unit-tested.
 */
import { CHUNK_SIZE } from '../../../core/model/constants';
import { getCell, getFootprint } from '../../../core/model/grid-model';
import { TerrainType } from '../../../core/model/types';
import type { GridState } from '../../../core/model/types';
import { entriesNear, getObjectIndex } from '../../../state/object-index';
import { getPlacedObjectSize } from '../../../state/object-geometry';

export interface NumberCell { x: number; y: number; label: string }

/* ── Shared label GLYPH look ──────────────────────────────────────────────────
 * Both renderers draw the number labels onto a CanvasRenderingContext2D (the 2D
 * per-chunk raster + the 3D per-chunk label atlas) with the identical style:
 * bold 14px monospace, white fill over a 3px black outline, bottom-left anchored.
 * These are the single source for that look so the two rasters can't drift. */

/** Configure `ctx` for the number-label glyphs. Call once before a batch of draws. */
export function setNumberLabelStyle(ctx: CanvasRenderingContext2D): void {
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
}

/** Draw one label (white over a black outline) with its bottom-left at (px, py). */
export function drawNumberLabel(ctx: CanvasRenderingContext2D, label: string, px: number, py: number): void {
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeText(label, px, py);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, px, py);
}

/** Labelled cells of chunk (cx, cy). Object-covered cells are masked using the
 *  canonical macro footprint (position .. position + size − 1), matching the
 *  sprite that would cover the number. */
export function chunkNumberCells(state: GridState, cx: number, cy: number, hiddenLayers: ReadonlySet<number>): NumberCell[] {
  const x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
  const x1 = Math.min(x0 + CHUNK_SIZE, state.template.width);
  const y1 = Math.min(y0 + CHUNK_SIZE, state.template.height);
  if (x1 <= x0 || y1 <= y0) return [];

  // Occupancy mask from the spatial index — only objects near this chunk matter.
  const occupied = new Set<string>();
  const near = entriesNear(getObjectIndex(state), { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  for (const e of near) {
    const dims = getPlacedObjectSize(e.obj);
    for (const c of getFootprint(e.obj.position.x, e.obj.position.y, dims.w, dims.h)) {
      occupied.add(`${c.x},${c.y}`);
    }
  }

  const out: NumberCell[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (occupied.has(`${x},${y}`)) continue;
      const cell = getCell(state.cells, x, y);
      if (!cell) continue;
      if (cell.terrain && cell.terrain.type === TerrainType.None) continue;
      const elev = cell.terrain?.elevation ?? 0;
      if (hiddenLayers.has(elev)) continue;
      out.push({ x, y, label: String(elev) });
    }
  }
  return out;
}
