/** What Generate's scope asks of the region brush, and when the painted scope is too small to fill. */
import { cellEdges } from '../../core/model/annotation/dimensions';
import type { MacroCoord } from '../../core/model/types';
import { REGION_TOOLS, type RegionRequest, type RegionTool } from '../../state/editing/vocabulary';
import { KIND_ENGINE, type GenerateKind } from './kinds';
import { STENCIL_MIN_SIDE } from './stencil/stencil';

/** Image and text fills require an interior, so their scopes offer only rectangles and circles. */
export const SCOPE_TOOLS_FOR: Readonly<Partial<Record<GenerateKind, readonly RegionTool[]>>> = {
  image: ['rect', 'circle'],
  text: ['rect', 'circle'],
};

/** What Generate's scope asks of the region brush for `kind`, which the scope chip starts it under:
 *  the tools it can be scoped by, and for a fill one figure no shorter than the fill's floor. */
export function scopeRequestFor(kind: GenerateKind): RegionRequest {
  const { input } = KIND_ENGINE[kind];
  const minSide = input ? STENCIL_MIN_SIDE[input] : null;
  return { tools: SCOPE_TOOLS_FOR[kind] ?? REGION_TOOLS, single: minSide !== null, minSide };
}

/** Whether a painted scope's box is shorter on a side than the request's `minSide`, in cells; a
 *  request without a floor, or no scope at all, never is. */
export function scopeFallsShort(region: readonly MacroCoord[], minSide: number | null): boolean {
  if (minSide === null) return false;
  const bounds = cellEdges(region);
  return bounds !== null && Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) < minSide;
}
