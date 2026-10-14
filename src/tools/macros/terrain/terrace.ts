/**
 * Nested-ring terracing on live cells: a mound climbs by raising the inset core of what was just
 * raised, so every step nests in its parent. It reads no tier field or region, so a press works on
 * hand-painted ground as on generated ground. Pure: it places, validates and reads no rule.
 *
 * Legal by construction: V-MTN-03 asks a tier-N cell for a full 3x3 at >= N-3. The ring at tier N is
 * the cells at erosion distance >= `inset` from the ring below, and with `inset >= 2` (the erosion is
 * Manhattan) every 8-neighbour lies in that lower ring at >= N-1. Tiers 1-3 are the rule's exemption
 * and need no inset, which keeps the flat top flat.
 *
 * Cells the run may not raise (unbuildable ground, footprints, relief this hold did not build) are
 * absent from `base`, so a hole erodes from inside as the rim does from outside, and the summit steps
 * away from a hand-built mountain.
 */
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { stepDistance, largestComponent } from '../../../core/grid/cell-sets';
import type { MacroCoord } from '../../../core/model/types';
import { BASE_SUPPORT } from '../../../core/game/profile';

/** The highest tier a flat top may reach. V-MTN-03 exempts the layers below `BASE_SUPPORT.fromLayer`,
 *  so this is where the shape has to start nesting, and the ladder's stage boundary is drawn there
 *  rather than hidden. */
export const FLAT_TOP = BASE_SUPPORT.fromLayer - 1;

/** The smallest core worth another tier. Below it a ring is a pixel on a hillside, not a summit. */
const MIN_CORE = 3;

interface TerraceInput {
  /** Every cell the run may raise, the noisy rim already applied. Cells it may not raise are absent
   *  rather than flagged: to this module they are outside, which is what makes a hole erode. */
  base: readonly MacroCoord[];
  /** The tier the summit is asked for. The footprint may not carry it; see the return. */
  peak: number;
  /** Cells of inset per tier above `FLAT_TOP`. 2 is a spire's step, 4 a landing deep enough for the
   *  ramp rule. Clamped to at least 2: below that the support argument above does not hold, and a
   *  disc terraced at 1 fails V-MTN-03 on most radii rather than a few. */
  inset: number;
  width: number;
  height: number;
}

/** One tier of the mass: every cell standing at that tier or above. Rings are cumulative, because
 *  the caller paints from tier 1 up (V-MTN-02 forbids skipping a rung) and an annulus would make it
 *  union them back together at every tier. */
export interface TerraceRing { tier: number; cells: MacroCoord[] }

/**
 * The mass, tier by tier, from 1. Shorter than `peak` when the footprint erodes away first, and
 * `rings.length` is then the tier this ground can carry: what the ghost reports, and what a hold
 * stops climbing at rather than spending a burst per tick on a rise that cannot happen.
 */
export function terraceRings(input: TerraceInput): TerraceRing[] {
  const { base, peak, width: W, height: H } = input;
  const inset = Math.max(2, Math.round(input.inset));
  if (base.length === 0 || peak < 1) return [];
  const rings: TerraceRing[] = [];
  const flat = base.slice();
  for (let tier = 1; tier <= Math.min(peak, FLAT_TOP); tier++) rings.push({ tier, cells: flat });
  let core = flat;
  for (let tier = FLAT_TOP + 1; tier <= peak; tier++) {
    core = erodeCore(core, inset, W, H);
    if (core.length < MIN_CORE) break;
    rings.push({ tier, cells: core });
  }
  return rings;
}

/**
 * The `inset`-deep core of a cell set: `carveCrown`'s erosion, on cells.
 *
 * The distance field is seeded from the set's own boundary (a cell with a 4-neighbour outside it),
 * so distance is measured to the nearest edge of the mass whether that edge is the rim or a hole.
 * `largestComponent` then keeps one core: two cores at one tier are two summits, and a ladder
 * climbs one.
 */
function erodeCore(cells: readonly MacroCoord[], inset: number, W: number, H: number): MacroCoord[] {
  const inSet = new Set<number>();
  for (const c of cells) inSet.add(c.y * W + c.x);
  const boundary: number[] = [];
  for (const i of inSet) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !inSet.has(ny * W + nx)) { boundary.push(i); break; }
    }
  }
  const d = stepDistance(boundary, W, H);
  const kept: number[] = [];
  for (const i of inSet) if (d[i]! >= inset) kept.push(i);
  return largestComponent(kept, W).map((i) => ({ x: i % W, y: (i / W) | 0 }));
}
