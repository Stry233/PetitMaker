/*
 * coloredpencil.ts — the mechanical track's pencil drawing: XDoG sketch lines, oriented hatch
 * strokes and a tooth that keeps the paper's white in the lights (see `../pencilize`). The strokes
 * FOLLOW THE MAP where it has direction — along roads, along shores — because the pack hands the
 * pass an orientation field built from the fields' own distance gradients.
 */
import { signedDistanceField } from '../geom';
import { fnv1a } from '../noise';
import { applySubstrate, sheetView } from '../draw';
import type { ProcFields } from '../fields';
import type { ProcView } from '../draw';
import { pencilize } from '../pencilize';
import type { Bitmap } from '../watercolorize';
import { drawBase } from './aquarelle';
import { procPackMeta } from './manifest';
import type { ProcPack } from './types';

/** Radians per cell: strokes run ALONG roads and shores (the sdf gradient turned a quarter), and
 *  fall to NaN where the map has no opinion, which the pass reads as "use the sketching angle". */
function orientationGrid(F: ProcFields): Float32Array {
  const n = F.width * F.height;
  const road = signedDistanceField(F.road, F.width, F.height);
  const grid = new Float32Array(n).fill(NaN);
  const at = (f: Float32Array, x: number, y: number): number =>
    f[Math.max(0, Math.min(F.height - 1, y)) * F.width + Math.max(0, Math.min(F.width - 1, x))]!;
  for (let y = 0; y < F.height; y++) {
    for (let x = 0; x < F.width; x++) {
      const i = y * F.width + x;
      const nearRoad = Math.abs(road[i]!) <= 1.6;
      const nearCoast = Math.abs(F.landSdf[i]!) <= 2.2;
      if (!nearRoad && !nearCoast) continue;
      const f = nearRoad ? road : F.landSdf;
      const gx = at(f, x + 1, y) - at(f, x - 1, y);
      const gy = at(f, x, y + 1) - at(f, x, y - 1);
      if (gx * gx + gy * gy < 1e-6) continue;
      grid[i] = Math.atan2(gy, gx) + Math.PI / 2;
    }
  }
  return grid;
}

function filterImage(img: Bitmap, seed: number, F?: ProcFields, view?: ProcView): void {
  let orientation: ((x: number, y: number) => number) | undefined;
  if (F && view) {
    const grid = orientationGrid(F);
    const inv = 1 / view.pxPerCell;
    orientation = (x: number, y: number): number => {
      const cx = Math.max(0, Math.min(F.width - 1, (view.x0 + x * inv) | 0));
      const cy = Math.max(0, Math.min(F.height - 1, (view.y0 + y * inv) | 0));
      const a = grid[cy * F.width + cx]!;
      return Number.isNaN(a) ? 0.72 : a;
    };
  }
  pencilize(img, { seed: fnv1a(String(seed) + 'cp'), ...(orientation ? { orientation } : {}) });
}

function drawColoredpencil(ctx: CanvasRenderingContext2D, F: ProcFields, view: ProcView): void {
  const S = sheetView(view, { left: 0, top: 0, right: 0, bottom: 0 });
  const W = Math.ceil(S.W), H = Math.ceil(S.H);
  drawBase(ctx, F, view);
  const img = ctx.getImageData(0, 0, W, H);
  filterImage(img, F.seed, F, view);
  ctx.putImageData(img, 0, 0);
  applySubstrate(ctx, W, H, { grain: 0.008, seed: 7, vignette: 0.04 });
}

export const coloredpencilPack: ProcPack = {
  ...procPackMeta('coloredpencil')!,
  draw: drawColoredpencil,
  filterImage,
};
