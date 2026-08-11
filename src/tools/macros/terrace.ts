/**
 * NESTED-RING TERRACING, ON LIVE CELLS.
 *
 * The generator climbs a zone into a massif by carving the INSET CORE of what it just raised and
 * raising that core one tier further (`generation/zones.ts:carveCrown`), so every step nests inside
 * its parent. This is that math on CELLS: no zone graph, no `ZonePlan`, no adjacency map, none of
 * the planning-time island. It is a PORT rather than a call, because `carveCrown` mutates a plan in
 * place and has no live-map shape to hand back.
 *
 * PURE. It places nothing, validates nothing and reads no rule.
 *
 * WHY THE RINGS ARE LEGAL BY CONSTRUCTION. V-MTN-03 asks a cell at tier N for a FULL 3x3 of mass at
 * >= N-3. The ring at tier N is the set of cells at erosion distance >= `inset` from the ring below
 * it, so with `inset >= 2` every 8-neighbour of an N cell lies inside that lower ring and carries
 * mass >= N-1, which is >= N-3; the centre is its own mass. So the 3x3 is full, at every tier, for
 * every footprint, without one retry. (The erosion metric is Manhattan, so an 8-neighbour sits two
 * steps away and it takes an inset of 2 to enclose it; an inset of 1 guarantees the 4-neighbours
 * only.) Tiers 1-3 are the rule's own exemption and need no inset, which is what makes the flat top
 * flat.
 *
 * A HOLE IS A BOUNDARY. Cells the run may not raise — unbuildable ground, an object's footprint,
 * relief this hold did not build — are simply absent from `base`, and the erosion seeds from the
 * set's own boundary, so a hole erodes from the inside exactly as the rim erodes from the outside.
 * The summit steps AWAY from a hand-built mountain instead of leaning on it, and the argument above
 * survives a disc with a hole in it.
 */
import { NEIGHBORS4, distanceField } from '../../core/model/grid-model';
import type { MacroCoord } from '../../core/model/types';
import { largestComponent } from '../generation/geometry';

/** The highest tier a flat top may reach. V-MTN-03 exempts 1-3 and engages at 4, so this is where
 *  the shape has to start nesting; it is the old plateau macro's hidden ceiling, promoted to the
 *  ladder's visible stage boundary. */
export const FLAT_TOP = 3;

/** The smallest core worth another tier. Below it a ring is a pixel on a hillside, not a summit. */
export const MIN_CORE = 3;

export interface TerraceInput {
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

/** One tier of the mass: every cell standing AT that tier or above. Rings are CUMULATIVE, because
 *  the caller paints from tier 1 up (V-MTN-02 forbids skipping a rung) and an annulus would make it
 *  union them back together at every tier. */
export interface TerraceRing { tier: number; cells: MacroCoord[] }

/**
 * The mass, tier by tier, from 1. SHORTER than `peak` when the footprint erodes away first, and
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
 * The distance field is seeded from the set's OWN boundary (a cell with a 4-neighbour outside it),
 * so distance is measured to the nearest edge of the mass whether that edge is the rim or a hole.
 * `largestComponent` then keeps ONE core: two cores at one tier are two summits, and a ladder
 * climbs one.
 */
export function erodeCore(cells: readonly MacroCoord[], inset: number, W: number, H: number): MacroCoord[] {
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
  const d = distanceField(boundary, W, H);
  const kept: number[] = [];
  for (const i of inSet) if (d[i]! >= inset) kept.push(i);
  return largestComponent(kept, W).map((i) => ({ x: i % W, y: (i / W) | 0 }));
}
