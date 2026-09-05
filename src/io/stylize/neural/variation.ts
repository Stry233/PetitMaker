/*
 * variation.ts — what a take's seed changes about a neural render.
 *
 * The model is deterministic, so two runs on the same frame are the same picture. It is also
 * equivariant: the picture follows the input under a mirror, a shift or a small scale, while the
 * textures it invents (brush phase, paper grain, canopy blobs) do not repeat under them. So a take
 * varies the FRAMING, runs the model, and undoes the framing: the layout comes back exactly and the
 * medium comes back different. Pure maths, browser-free, so the mapping is testable.
 */

export interface Variation {
  flipX: boolean;
  flipY: boolean;
  /** The map's size inside the frame relative to its full fit, below 1 so a shift stays inside. */
  scale: number;
  /** Shift of the map inside the frame, as a share of the room `scale` leaves on each axis. */
  shiftX: number;
  shiftY: number;
}

const SCALE_MIN = 0.94;

/** Deterministic in the seed; seed 0 (no roll) is the plain framing. */
export function variationFor(seed: number): Variation {
  if (seed === 0) return { flipX: false, flipY: false, scale: 1, shiftX: 0.5, shiftY: 0.5 };
  let h = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 0x100000000;
  };
  return {
    flipX: next() < 0.5,
    flipY: next() < 0.5,
    scale: SCALE_MIN + next() * (1 - SCALE_MIN),
    shiftX: next(),
    shiftY: next(),
  };
}
