/**
 * Shared admission predicates for UNTRUSTED decoded data (imported saves + restored history).
 *
 * A crafted save/history section could smuggle NaN coordinates, 45° rotations, or out-of-range
 * elevations past a bare type cast and corrupt every downstream footprint read — or, for objects,
 * reach the AI agent's model context as a prompt-injection vector. `json-codec` (the map decoder)
 * and `history-codec` (the undo-stack decoder) apply the SAME trust bar; these are the single
 * source for the primitive checks both share, so the policy lives in one place.
 */
import { TerrainType } from '../core/model/types';
import { ELEVATION_MAX } from '../core/model/constants';

/** Terrain types a decoded/imported cell may legally carry (None/Mountain/Water). */
export const VALID_TERRAIN_TYPES: readonly number[] = [TerrainType.None, TerrainType.Mountain, TerrainType.Water];
/** Legal object rotations, in degrees. */
export const VALID_ROTATIONS: readonly number[] = [0, 90, 180, 270];

export const isValidTerrainType = (t: unknown): boolean => VALID_TERRAIN_TYPES.includes(t as number);
export const isValidRotation = (r: unknown): boolean => VALID_ROTATIONS.includes(r as number);
/** An elevation-like field (elevation / patchBase): an integer within [0, ELEVATION_MAX]. */
export const isValidElevation = (e: unknown): boolean =>
  Number.isInteger(e) && (e as number) >= 0 && (e as number) <= ELEVATION_MAX;
