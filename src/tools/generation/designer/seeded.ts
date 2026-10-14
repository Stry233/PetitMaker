/** The designer's positional fields, built on `core/base/hash.ts:seedHash01`. */
import { seedHash01 } from '../../../core/base/hash';
import { smoothLattice } from '../../../core/base/noise';

/** A smooth -1..1 field over the map, smoothstep-interpolated between seeded lattice values `span`
 *  cells apart, so what it places gathers instead of speckling. */
export function fieldNoise(seed: number, x: number, y: number, span: number): number {
  return smoothLattice((ix, iy) => seedHash01(seed, ix * 73856093 ^ iy * 19349663) * 2 - 1, x / span, y / span);
}

/** Distances from the plaza, in cells: dry up to `dry`, ramping in to the wet band `from`..`to`,
 *  fading out by `fade`. */
export interface RingProfile { dry: number; from: number; to: number; fade: number }

/** The wet band the built-in planets show round the plaza: 30 to 50 cells out, tapering to nothing at
 *  the coast. Each pass that reads it sets its own dry apron. */
export const WET_BAND: Omit<RingProfile, 'dry'> = { from: 30, to: 50, fade: 74 };

/** How much a pass wants a cell at `ring` cells from the plaza: -1 on the dry apron, 1 in the wet
 *  band, ramping between, 0 at the coast. */
export function ringPull(ring: number, profile: RingProfile): number {
  if (ring <= profile.dry) return -1;
  if (ring < profile.from) return (ring - profile.dry) / (profile.from - profile.dry);
  if (ring <= profile.to) return 1;
  return Math.max(0, 1 - (ring - profile.to) / (profile.fade - profile.to));
}
