/**
 * The ONE count + min/max-bounds derivation over a painted region.
 *
 * THREE SURFACES ASK THE SAME QUESTION and must never answer it three ways: the agent's region
 * guard quotes the bounds back to the model when a write strays outside them
 * (`agent/tools/tools-common.ts`), the order event stamps the region it was FILED under onto the
 * record, and the composer's region chip says what the user has marked. A second copy of this math
 * would show as a chip whose numbers disagree with the refusal the model was just sent.
 *
 * IT LIVES HERE, BELOW ALL THREE, because imports point down: the chip is UI and the guard is the
 * agent layer, and `state/` is the deepest place both already reach. It reads nothing but the list
 * it is handed, so it is as testable as it is shared.
 */
import type { MacroCoord } from '../core/model/types';

/** A region's size and its bounding box, inclusive on all four sides. Structurally the agent
 *  layer's `OrderRegion` (the record's filed copy), which is what lets the same value be stamped
 *  onto an order and read back by the ticket head. */
export interface RegionBounds {
  count: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Null for an empty region — `[]` is the store's ONE representation of "nothing marked", which
 *  means the whole map, not a box of zero cells. */
export function regionBounds(region: readonly MacroCoord[]): RegionBounds | null {
  if (region.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of region) {
    if (c.x < x1) x1 = c.x;
    if (c.y < y1) y1 = c.y;
    if (c.x > x2) x2 = c.x;
    if (c.y > y2) y2 = c.y;
  }
  return { count: region.length, x1, y1, x2, y2 };
}
