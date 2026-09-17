// src/io/export/render.ts
import { computeComposition } from './compose';
import { layersFor } from './layer-preview';
import type { Badge, ExportComposition, ExportOptions } from './types';
import type { CanvasLimits, PixelSize } from './sizing';
import type { GridState } from '../../core/model/types';
import type { MapProvenanceSummary } from '../../core/provenance/types';

export interface RenderArgs {
  summary: MapProvenanceSummary;
  /** The live grid that sizes the per-layer construction strip. */
  gridState?: GridState;
  options: ExportOptions; mapAspect: number;
  /** Actual captured map pixel size (loaded base image dims). Drives Original 1:1 layout. */
  mapPx?: PixelSize;
  /** What this device's canvas can allocate (`canvas-limits.ts`). Desktop's constants when absent. */
  limits?: CanvasLimits;
  /** Paint the composition into an offscreen canvas and return it (or null). */
  capture: (comp: ExportComposition) => Promise<HTMLCanvasElement | null>;
  /** Encode the painted canvas to an image Blob (browser: canvas.toBlob → PNG). Plain encoding —
   *  the share code (if any) was already painted into the composition as a visible band by
   *  `capture`, so there is no pixel-level embedding step here. The canvas is handed over as it
   *  is: an encode reads the pixels once, and any buffer between the two would copy the whole
   *  image out of the canvas and back into another. */
  encode: (canvas: HTMLCanvasElement) => Promise<Blob>;
}

export interface RenderResult { blob: Blob | null; composition: ExportComposition }

/** Compose, capture, and encode an export whose optional share code is already visible in the canvas. */
export async function renderExport(args: RenderArgs): Promise<RenderResult> {
  const badges = badgesFor(args.summary);
  const layerCount = args.gridState ? layersFor(args.gridState).length : 1;
  const composition = computeComposition(args.options, args.mapAspect, badges, { layerCount, mapPx: args.mapPx, limits: args.limits });
  const canvas = await args.capture(composition);
  const blob = canvas ? await args.encode(canvas) : null;
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
