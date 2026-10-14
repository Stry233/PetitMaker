/**
 * An export composed in tiles when the device cannot hold it in one canvas: each tile is painted
 * through the ordinary painter with the context translated and clipped to it, read back, and
 * streamed into a PNG. The file is the same size on every device; only the tiling differs.
 */
import { canvasFitScale, type CanvasLimits } from './sizing';
import { PngStream } from './png-stream';
import { planTiles } from './tile-plan';
import { nextMacrotask, throwIfAborted } from '../../platform/async/abort';

/** The part of the composition a tile shows, in composition pixels. */
export interface BandWindow { left: number; top: number; right: number; bottom: number }

/** Whether a composition of this size outgrows what one canvas may hold here. */
export function needsBanding(size: { width: number; height: number }, limits: CanvasLimits): boolean {
  return canvasFitScale(size.width, size.height, limits) < 1;
}

/** A drawing surface of one tile's size, read back as RGBA rows. */
export interface BandSurface {
  ctx: CanvasRenderingContext2D;
  read(w: number, h: number): Uint8ClampedArray;
  destroy(): void;
}

function canvasSurface(w: number, h: number): BandSurface {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2D context for the export tile');
  return {
    ctx,
    read: (rw, rh) => ctx.getImageData(0, 0, rw, rh).data,
    destroy: () => { canvas.width = 0; canvas.height = 0; },
  };
}

export interface RenderBandedArgs {
  width: number;
  height: number;
  limits: CanvasLimits;
  /** Paints the whole composition; the transform already maps composition coordinates onto the tile. */
  paint: (ctx: CanvasRenderingContext2D, window: BandWindow) => void | Promise<void>;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Test seam for the tile surface. */
  surface?: (w: number, h: number) => BandSurface;
  /** zlib level; the default trades size for the time a phone spends. */
  level?: number;
}


export async function renderBanded(args: RenderBandedArgs): Promise<Blob> {
  const { width, height, limits, paint, signal } = args;
  const plan = planTiles(width, height, limits);
  const tileW = plan.cols[0]!.w;
  const tileH = plan.rows[0]!.h;
  const surface = (args.surface ?? canvasSurface)(tileW, tileH);
  const png = new PngStream(width, height, { level: args.level ?? 4 });
  // Rows are assembled across columns before they reach the encoder.
  const rowBuffer = plan.cols.length > 1 ? new Uint8Array(width * tileH * 4) : null;
  try {
    for (const [ri, row] of plan.rows.entries()) {
      for (const col of plan.cols) {
        throwIfAborted(signal);
        const window: BandWindow = { left: col.x, top: row.y, right: col.x + col.w, bottom: row.y + row.h };
        const { ctx } = surface;
        ctx.setTransform(1, 0, 0, 1, -col.x, -row.y);
        ctx.clearRect(col.x, row.y, col.w, row.h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(col.x, row.y, col.w, row.h);
        ctx.clip();
        await paint(ctx, window);
        ctx.restore();
        throwIfAborted(signal);
        const pixels = surface.read(col.w, row.h);
        if (!rowBuffer) {
          png.addRows(pixels, row.h);
        } else {
          for (let y = 0; y < row.h; y++) {
            rowBuffer.set(pixels.subarray(y * col.w * 4, (y + 1) * col.w * 4), (y * width + col.x) * 4);
          }
        }
      }
      if (rowBuffer) png.addRows(rowBuffer.subarray(0, row.h * width * 4), row.h);
      args.onProgress?.((ri + 1) / plan.rows.length);
      await nextMacrotask(); // a macrotask between bands, so progress paints and a cancel is heard
    }
    return png.finish();
  } finally {
    surface.destroy();
  }
}
