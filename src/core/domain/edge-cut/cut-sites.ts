/*
 * The cut sites at a corner, for the manual corner tool and the auto-trim alike: which outer cut a
 * corner offers and the tier a Γ fillet lands at. Each consumer keeps its own policy on top (the
 * auto-trim never cuts a fillet's outer corner, the tool cycles every site at a click).
 */
import { TerrainType, type GridState } from '../../model/types';
import { getCell } from '../../model/grid-model';
import type { RoadLookup } from '../../model/road-lookup';
import { computeLockedCorners } from './trim-lock';
import { groundConvexCornerInWater } from './silhouette';
import { isInnerCorner } from './cut-validator';

/** An outer cut a corner offers: a block's convex corner, or a ground islet's corner poking into water. */
export type OuterCutSite = 'block' | 'islet';

/**
 * The outer cut each corner of (x, y) offers, or null. A real block, or a fillet with a real base
 * (`patchBase` 1 or more), bevels a convex corner no same-tier neighbour pins (`computeLockedCorners`);
 * a from-empty fillet has no base and offers none. Plain ground rounds a corner that pokes into water,
 * the cut living on the ground cell. Read per corner; the cell's locks are computed once.
 */
export function outerCutSites(state: GridState, roads: RoadLookup, x: number, y: number): (corner: number) => OuterCutSite | null {
  const t = getCell(state.cells, x, y)?.terrain;
  const terrain = t && t.type !== TerrainType.None ? t : null;
  if (terrain && (!terrain.patchOnly || (terrain.patchBase ?? 0) >= 1)) {
    const locked = computeLockedCorners(state, roads, x, y, 'terrain');
    return (corner) => (locked[corner] ? null : 'block');
  }
  if (!terrain) return (corner) => (groundConvexCornerInWater(state, x, y, corner) ? 'islet' : null);
  return () => null;
}

/**
 * The highest tier in (`floor`, `top`] at which corner `corner` of (x, y) is a Γ notch of a `type`
 * mass (`isInnerCorner`), or 0 when none. Searched down from the tallest neighbour: walls of unequal
 * height wrap a corner only up to the shorter one, so asking about the tallest tier alone refuses
 * the whole notch.
 */
export function gammaTier(
  state: GridState, x: number, y: number, corner: number,
  mass: { type: TerrainType; top: number; floor: number },
): number {
  for (let e = mass.top; e > mass.floor && e >= 1; e--) {
    if (isInnerCorner(state, x, y, corner, { type: mass.type, elevation: e })) return e;
  }
  return 0;
}
