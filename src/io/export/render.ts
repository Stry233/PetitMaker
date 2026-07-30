// src/io/export/render.ts
import { computeComposition } from './compose';
import { layersFor } from './layer-preview';
import type { Badge, ExportComposition, ExportOptions } from './types';
import type { PixelSize } from './sizing';
import type { GridState } from '../../core/model/types';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import type { PixelBuffer } from './paint-types';

export interface RenderArgs {
  summary: MapProvenanceSummary;
  /** The live grid (used to size the per-layer construction strip). */
  gridState?: GridState;
  options: ExportOptions; mapAspect: number;
  /** Actual captured map pixel size (loaded base image dims). Drives Original 1:1 layout. */
  mapPx?: PixelSize;
  /** Paint the composition into an offscreen canvas and return its pixel buffer (or null). */
  capture: (comp: ExportComposition) => Promise<PixelBuffer | null>;
  /** Encode the final buffer to an image Blob (browser: canvas.toBlob → PNG). Plain encoding —
   *  the share code (if any) was already painted into the composition as a visible band by
   *  `capture`, so there is no pixel-level embedding step here. */
  encode: (buf: PixelBuffer) => Promise<Blob>;
}

export interface RenderResult { blob: Blob | null; composition: ExportComposition }

/** Compose → capture → encode. No image-watermarking: the share code (PetitGlyph v2) is a
 *  visible band painted into the composed image, not pixel-nudged steganography. The composition
 *  is returned so the caller can report sizing (e.g. Original 1:1). */
export async function renderExport(args: RenderArgs): Promise<RenderResult> {
  const badges = badgesFor(args.summary);
  const layerCount = args.gridState ? layersFor(args.gridState).length : 1;
  const composition = computeComposition(args.options, args.mapAspect, badges, { layerCount, mapPx: args.mapPx });
  const buf = await args.capture(composition);
  const blob = buf ? await args.encode(buf) : null;
  return { blob, composition };
}

/** Presence badges for the export: AI and/or Procedural, co-existing. Human-only → none.
 *  Driven purely by what content currently remains (containsAi/containsProcedural). */
export function badgesFor(summary: MapProvenanceSummary | null): Badge[] {
  const out: Badge[] = [];
  if (summary?.containsAi) out.push({ label: 'prov.badge_ai', color: '#8E7BD6' });
  if (summary?.containsProcedural) out.push({ label: 'prov.badge_proc', color: '#5BB6A6' });
  return out;
}

/** Pills shrink when both badges show, so they never crowd the title. */
export function badgeScale(count: number): number { return count >= 2 ? 0.8 : 1; }
