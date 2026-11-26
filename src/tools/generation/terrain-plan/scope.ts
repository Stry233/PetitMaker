/**
 * What a run is allowed to touch: the painted region, as the predicate every commit, clear and build
 * stage asks. The region's membership is built once here, never a per-cell key.
 *
 * The designer plans the planet whole and the region crops what lands
 * (`designer/pipeline.ts:DesignedContext.region`), so nothing earlier than the commit knows a region
 * exists at all.
 */
import { flatIndex } from '../../../core/grid/rect';
import { footprintCells } from '../../../core/grid/footprint';
import type { MacroCoord } from '../../../core/model/types';

/**
 * What a run is allowed to touch.
 *
 * `cell` gates a single macro cell and `rect` an object's whole footprint, because that is the unit
 * a stray is measured in: an object standing half outside the painted region is outside it. Both
 * answer true everywhere when no region was painted, so the unscoped path costs one predicate call
 * and no allocation.
 */
export interface Scope {
  readonly bounded: boolean;
  cell(x: number, y: number): boolean;
  rect(x: number, y: number, w: number, h: number): boolean;
}

export function makeScope(region: readonly MacroCoord[] | null | undefined, W: number, H: number): Scope {
  if (!region || region.length === 0) {
    return { bounded: false, cell: () => true, rect: () => true };
  }
  const mask = new Uint8Array(W * H);
  for (const c of region) {
    if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) mask[flatIndex(c.x, c.y, W)] = 1;
  }
  const cell = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && mask[flatIndex(x, y, W)] === 1;
  return {
    bounded: true,
    cell,
    rect: (x, y, w, h) => footprintCells(x, y, w, h).every((c) => cell(c.x, c.y)),
  };
}
