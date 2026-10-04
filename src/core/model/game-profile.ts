import type { Rotation } from './types';

// The game the editor plans maps for, as facts: porting the editor to another game replaces this
// module and the catalog and map data, not the modules that read them.

/** Cells on each side of a chunk, the unit of map size and load accounting. */
export const CHUNK_SIZE = 16;
/** The load one chunk may carry. */
export const CHUNK_LOAD_LIMIT = 10_000;
/** Whether placement enforces the measured catalog loads. */
export const CHUNK_LOAD_ENABLED = true;
/** Decimal precision of measured object loads. */
export const LOAD_DECIMALS = 1;
/** The highest terrain and water layer. */
export const ELEVATION_MAX = 8;

/**
 * The mountain-support rule (V-MTN-03): a mountain at `fromLayer` or higher stands on a centred
 * `window` by `window` square of cells whose mass reaches at least `reach` layers below it.
 * Lower layers stand on the ground.
 */
export const BASE_SUPPORT = { fromLayer: 4, reach: 3, window: 3 } as const;

/**
 * The game facts custom planets are built from. The planet model, its validator, codecs, session and
 * UI read them here, so another game's planets differ in this profile, not in the modules that read it.
 */
export const PLANET_PROFILE = {
  /** A custom planet is at most this many chunks on each side. */
  maxChunks: 16,
  /** Every sea or sand cell within this Chebyshev radius of grass or plaza is the shore rim, so the
   *  rim is one cell wide between the grass and whatever lies beyond. The built-in planets' Boundary
   *  cells are exactly this set. */
  shoreRadius: 1,
  /** The highest mountain layer a custom planet's ground may take while it is shaped; 0 keeps the
   *  ground flat. Planets saved with higher layers still load, keep them and may be lowered. */
  maxLayer: 0,
  /** Every custom template id starts with this; no built-in id does. */
  templatePrefix: 'custom-',
  /** The landmark a custom planet lays, as on the built-in planets: its unturned footprint in cells
   *  and its base elevation. */
  landmark: { width: 20, height: 27, elevation: 1 },
  /** The landmark's icon basename, on every planet. */
  landmarkIcon: 'plaza',
  /** The footprint turns the landmark may take while its planet is shaped. */
  rotations: [0, 90, 180, 270] satisfies readonly Rotation[],
} as const;
