import { computeComposition } from './compose';
import { layersFor } from './layer-preview';
import type { Badge, DroppedRows, ExportComposition, ExportOptions } from './types';
import type { CanvasLimits, PixelSize } from './sizing';
import type { GridState } from '../../core/model/types';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import { AI_BADGE, PROCEDURAL_BADGE } from '../../assets/brand-palette';

/** The layout an export of `state` takes with its map band `mapPx` big at `mapAspect`, inside the
 *  canvas `limits` and without the `dropped` rows; the export and its preview both lay out through
 *  it, so they agree. */
export function exportComposition(
  options: ExportOptions, state: GridState, summary: MapProvenanceSummary | null,
  map: { aspect: number; px: PixelSize }, fit: { limits?: CanvasLimits; dropped?: DroppedRows } = {},
): ExportComposition {
  const { aspect: mapAspect, px: mapPx } = map;
  return computeComposition(options, mapAspect, badgesFor(summary), { layerCount: layersFor(state).length, mapPx, ...fit });
}

/** Presence badges for the export: AI and/or Procedural, co-existing. Human-only → none.
 *  Driven purely by what content currently remains (containsAi/containsProcedural). */
function badgesFor(summary: MapProvenanceSummary | null): Badge[] {
  const out: Badge[] = [];
  if (summary?.containsAi) out.push({ label: 'export.badge_ai', color: AI_BADGE });
  if (summary?.containsProcedural) out.push({ label: 'export.badge_proc', color: PROCEDURAL_BADGE });
  return out;
}

/** Pills shrink when both badges show, so they never crowd the title. */
export function badgeScale(count: number): number { return count >= 2 ? 0.8 : 1; }
