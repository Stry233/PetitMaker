/*
 * aquarelle.ts — the one built-in style: the map's own picture, watercolourised.
 *
 * The style is a structure-blind image pass (`../watercolorize`): in the app the pass paints over
 * the REAL 2D capture (see `render.ts`'s `sourceImage`), so every sprite the renderer drew
 * survives into the painting and the output is recognisable as the map by construction. This file
 * is the FALLBACK BASE for surfaces with no live renderer (the preview page, the sample bake): a
 * crisp flat rendering of the map's own colours from the fields, handed to the same pass — so the
 * shelf sample and the app's takes share one look.
 */
/* eslint-disable */
import { contentRandom, fnv1a } from '../noise';
import { hexToLch, mixHex, reColor, rgba } from '../oklab';
import { applySubstrate, sheetView } from '../draw';
import type { ProcFields, ProcObject } from '../fields';
import type { ProcView } from '../draw';
import { watercolorize } from '../watercolorize';
import { procPackMeta } from './manifest';
import type { ProcPack } from './types';

/* A flower's authored top colour is usually the leaf; the bloom colour is the highest part of the
   model whose hue is not foliage. */
const aquarelle_bloomCache = new Map<string, string>();
function aquarelle_bloomColor(o: ProcObject): string {
  const cached = aquarelle_bloomCache.get(o.catalogId);
  if (cached) return cached;
  let best: string | null = null;
  let bestScore = -1e9;
  for (const p of o.item?.model3d?.parts ?? []) {
    const col = p.color;
    if (typeof col !== 'string') continue;
    const [, C, h] = hexToLch(col);
    const deg = ((h * 180 / Math.PI) + 360) % 360;
    const foliage = deg > 95 && deg < 180;
    const score = (foliage ? -3 : 0) + C * 8 + p.pos[1] * 0.02;
    if (score > bestScore) { bestScore = score; best = col; }
  }
  const out = best ?? (o.topColor || '#c96a76');
  aquarelle_bloomCache.set(o.catalogId, out);
  return out;
}

/** The flat base: the map as plain colour, crisp — the same job the game's own renderer does,
 *  reduced to what the fields know. The watercolour pass supplies all the medium; the tinted-wash
 *  pack borrows the same base as its own fallback content. */
export function drawBase(ctx: CanvasRenderingContext2D, F: ProcFields, view: ProcView): void {
  const pal = procPackMeta('aquarelle')!.palette;
  const S = sheetView(view, { left: 0, top: 0, right: 0, bottom: 0 });
  const { px, T, W, H } = S;
  const n = F.width * F.height;

  /* open sea vs inland ponds */
  const outer = new Uint8Array(n);
  const queue = new Int32Array(n);
  let qHead = 0, qTail = 0;
  const flood = (i: number): void => { if (!outer[i] && F.water[i]) { outer[i] = 1; queue[qTail++] = i; } };
  for (let x = 0; x < F.width; x++) { flood(x); flood((F.height - 1) * F.width + x); }
  for (let y = 0; y < F.height; y++) { flood(y * F.width); flood(y * F.width + F.width - 1); }
  while (qHead < qTail) {
    const i = queue[qHead++]!, x = i % F.width, y = (i / F.width) | 0;
    if (x > 0) flood(i - 1); if (x < F.width - 1) flood(i + 1);
    if (y > 0) flood(i - F.width); if (y < F.height - 1) flood(i + F.width);
  }

  const g = pal.ground;
  const road = mixHex(pal.roadShade, pal.paper, 0.35);
  const sand = mixHex(pal.paper, pal.roadShade, 0.4);
  const pondC = mixHex(pal.water, pal.paper, 0.16);
  ctx.fillStyle = pal.water;
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < F.height; y++) {
    for (let x = 0; x < F.width; x++) {
      const i = y * F.width + x;
      let c: string | null;
      if (F.water[i]) c = outer[i] ? null : pondC;
      else if (F.road[i]) c = road;
      else if (F.beach[i]) c = sand;
      else c = g[Math.min(g.length - 1, F.elevation[i]!)]!;
      if (!c) continue;
      const p = T(x, y);
      ctx.fillStyle = c;
      ctx.fillRect(p[0], p[1], px + 0.5, px + 0.5);
    }
  }

  /* Every object as its own flat colour, the way the map shows it: buildings as their tops,
     trees as round crowns, flora as bloom dots. */
  for (const o of F.buildings) {
    const [sx, sy] = T(o.x, o.y);
    const src0 = o.topColor || '#9b8b6a';
    const [, srcC] = hexToLch(src0);
    const c = o.catalogId === '__plaza__'
      ? mixHex(pal.paper, pal.roadShade, 0.3)
      : (srcC < 0.06 ? mixHex(src0, '#B9A171', 0.5) : src0);
    ctx.fillStyle = c;
    ctx.fillRect(sx, sy, o.w * px, o.h * px);
    ctx.strokeStyle = rgba(reColor(c, { dL: -0.14 }), 0.8);
    ctx.lineWidth = Math.max(0.8, px * 0.08);
    ctx.strokeRect(sx, sy, o.w * px, o.h * px);
  }
  for (const o of F.plants) {
    const [sx, sy] = T(o.x + o.w / 2, o.y + o.h / 2);
    if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue;
    const rnd = contentRandom(o.catalogId, o.x, o.y, 'aq-b');
    if (o.category === 'tree') {
      const r = px * 0.5 * Math.min(1.6, Math.max(o.w, o.h)) * (0.85 + rnd() * 0.3);
      ctx.fillStyle = o.topColor || '#3a7a30';
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, r), 0, 6.2832); ctx.fill();
    } else {
      const r = px * 0.3 * (0.8 + rnd() * 0.4);
      if (r < 0.9) continue;
      ctx.fillStyle = aquarelle_bloomColor(o);
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(0.9, r), 0, 6.2832); ctx.fill();
    }
  }
}

function filterImage(img: import('../watercolorize').Bitmap, seed: number): void {
  watercolorize(img, { seed: fnv1a(String(seed) + 'aq') });
}

function drawAquarelle(ctx: CanvasRenderingContext2D, F: ProcFields, view: ProcView): void {
  const S = sheetView(view, { left: 0, top: 0, right: 0, bottom: 0 });
  const W = Math.ceil(S.W), H = Math.ceil(S.H);
  drawBase(ctx, F, view);
  const img = ctx.getImageData(0, 0, W, H);
  filterImage(img, F.seed);
  ctx.putImageData(img, 0, 0);
  applySubstrate(ctx, W, H, { grain: 0.006, seed: 7, vignette: 0.05 });
}

export const aquarellePack: ProcPack = {
  ...procPackMeta('aquarelle')!,
  draw: drawAquarelle,
  filterImage,
};
