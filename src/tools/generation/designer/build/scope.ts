/**
 * WHAT A RUN IS ALLOWED TO TOUCH: the painted region, as a predicate the whole build stage asks.
 *
 * The island is always designed whole and the region crops what lands (`pipeline.ts`'s
 * `DesignedContext.region`), so every place that puts something on the map asks the same two
 * questions here and nothing earlier in the pipeline knows a region exists at all.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import type { MacroCoord } from '../../../../core/model/types';

/**
 * What a run is allowed to touch.
 *
 * `cell` gates a single macro cell and `rect` an object's whole FOOTPRINT, because that is the unit
 * a stray is measured in: an object standing half outside the painted region is outside it. Both
 * answer true everywhere when no region was painted, so the unscoped path costs one predicate call
 * and no allocation.
 */
export interface Scope {
  readonly bounded: boolean;
  cell(x: number, y: number): boolean;
  rect(x: number, y: number, w: number, h: number): boolean;
}

export function makeScope(region: MacroCoord[] | null | undefined, W: number, H: number): Scope {
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
    rect: (x, y, w, h) => {
      for (let cy = Math.floor(y); cy < Math.ceil(y + h); cy++) {
        for (let cx = Math.floor(x); cx < Math.ceil(x + w); cx++) if (!cell(cx, cy)) return false;
      }
      return true;
    },
  };
}

/** Whether every cell from one bank to the other is in scope: the deck's own extent. */
export function spanInScope(scope: Scope, banks: readonly MacroCoord[]): boolean {
  const [a, b] = banks;
  if (!a || !b) return false;
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return scope.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}
