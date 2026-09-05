/*
 * render.ts — a map plus a pack becomes a bitmap the export can swap in.
 *
 * The band this draws must frame EXACTLY as the 2D capture does, because the plan-notes ink is
 * composed over the result at export time: a renderer that framed the cells alone would land the
 * user's ink half a cell off. Both framings come from `bandGeometry`, which is the one place that
 * fact lives.
 */
import type { GridState } from '../../../core/model/types';
import { buildProcFields } from './fields';
import { procPack } from './packs';
import type { ProcView } from './draw';
import { bandGeometry } from '../../export/sizing';
import { applySubstrate } from './draw';
import { canonicalBytes, canonicalize } from '../../share/canonical';
import { fnv1a } from './noise';

/** The seed a map's pictures descend from: a hash of the CANONICAL map (sorted, id-normalised,
 *  provenance-free), so the same map draws the same picture on every machine and after any
 *  save/load or share round trip — and a different map draws a different one. */
export function mapSeed(state: GridState): number {
  const bytes = canonicalBytes(canonicalize(state));
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) ^ fnv1a('stylize-proc');
}

/** The seed one TAKE draws from. Roll 0 is `mapSeed` itself — the canonical picture, the one the
 *  minis show — and every further roll of the same style folds its number into the hash, so a
 *  re-roll varies the wobble, grain and drifts while staying reproducible from the roll recorded
 *  on the version. */
export function takeSeed(state: GridState, roll: number): number {
  const base = mapSeed(state);
  return roll === 0 ? base : (base ^ Math.imul(roll, 0x9e3779b9)) >>> 0;
}

export interface ProcRenderRequest {
  state: GridState;
  packId: string;
  /** Longest side of the wanted bitmap, in pixels. The renderer keeps the band's own aspect. */
  maxPx: number;
  /** Stable across runs: the same map and pack always draw the same picture. */
  seed: number;
  /** The reader's locale, for the packs that letter anything. Never part of the seed. */
  locale?: string;
  /** The REAL rendered map band, where the caller has one (the app's 2D capture). When present the
   *  aquarelle pass paints over these pixels — every sprite the renderer drew survives into the
   *  painting — and the fields base is only the fallback for surfaces with no live renderer. */
  sourceImage?: CanvasImageSource;
}

/** The view a pack draws through, for a band of the given pixel width. */
export function procView(state: GridState, maxPx: number): ProcView {
  const band = bandGeometry(state.template);
  const scale = maxPx / Math.max(band.widthCells, band.heightCells);
  return {
    pxPerCell: scale,
    x0: band.originX,
    y0: band.originY,
    cellsW: band.widthCells,
    cellsH: band.heightCells,
  };
}

/** Draw one pack into a fresh canvas. Returns null where the pack id is unknown or the platform
 *  cannot give a 2D context, which is the case in the test environment. */
export function renderProcPack(req: ProcRenderRequest): HTMLCanvasElement | null {
  const pack = procPack(req.packId);
  if (!pack) return null;
  const view = procView(req.state, req.maxPx);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(view.cellsW * view.pxPerCell));
  canvas.height = Math.max(1, Math.round(view.cellsH * view.pxPerCell));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (req.sourceImage && pack.filterImage) {
    ctx.drawImage(req.sourceImage, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    pack.filterImage(img, req.seed, buildProcFields(req.state, req.seed, req.locale), view);
    ctx.putImageData(img, 0, 0);
    applySubstrate(ctx, canvas.width, canvas.height, { grain: 0.006, seed: 7, vignette: 0.05 });
    return canvas;
  }
  pack.draw(ctx, buildProcFields(req.state, req.seed, req.locale), view);
  return canvas;
}

/** The awaited face of `renderProcPack`, for callers on the event loop: a pack that draws through
 *  a model runs here; everything else falls through to the synchronous paths unchanged. */
export async function renderProcPackAsync(req: ProcRenderRequest): Promise<HTMLCanvasElement | null> {
  const pack = procPack(req.packId);
  if (!pack) return null;
  if (!pack.drawAsync) return renderProcPack(req);
  const view = procView(req.state, req.maxPx);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(view.cellsW * view.pxPerCell));
  canvas.height = Math.max(1, Math.round(view.cellsH * view.pxPerCell));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  await pack.drawAsync(ctx, buildProcFields(req.state, req.seed, req.locale), view, req.sourceImage);
  return canvas;
}
