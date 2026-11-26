/** Coordinate and turn primitives every core folder shares. Positions are in macro cells. */

export type MacroCoord = { x: number; y: number };
declare const BRAND: unique symbol;
/** `T` tagged with the space it lives in. A brand exists only in the type system: a value gains one
 *  through the function that knows the space, and loses nothing at run time. */
export type Brand<T, B> = T & { readonly [BRAND]: B };
/** A chunk's column and row. */
type ChunkXY = { cx: number; cy: number };
/** A storage bucket: BUCKET_SIZE cells aligned at cell 0, the unit renderers and indexes cull by. */
export type BucketCoord = Brand<ChunkXY, 'bucket'>;
/** A reference region: CHUNK_SIZE cells from the map's own chunk origin, the game chunk the map
 *  labels and the load meter counts. */
export type RegionCoord = Brand<ChunkXY, 'region'>;

/** Object footprint turns in degrees, clockwise from the catalog orientation. The share codec
 *  persists a rotation as its index in this order. */
export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = typeof ROTATIONS[number];
/** `r` turned by `quarterTurns` clockwise quarter turns; negative counts turn back. */
export function turnRotation(r: Rotation, quarterTurns: number): Rotation {
  return ((((r + quarterTurns * 90) % 360) + 360) % 360) as Rotation;
}

/** A layout's orientation on the grid about its own centre: mirrored left to right first when
 *  `mirror`, then turned `quarters` clockwise quarter turns. */
export interface Orientation { readonly quarters: number; readonly mirror?: boolean }

/** `o` followed by `then`, both about the same centre. A mirror after a turn is the mirror before the
 *  turn taken back, so a left-to-right mirror negates the quarters already turned. */
export function thenOrient(o: Orientation, then: Orientation): Orientation {
  const quarters = then.mirror ? then.quarters - o.quarters : o.quarters + then.quarters;
  return { quarters: ((quarters % 4) + 4) % 4, mirror: !!o.mirror !== !!then.mirror };
}

/** A place in Flip's cycle as the screen shows it: 0 as it began, 1 mirrored left to right, 2 top
 *  to bottom, 3 both, which is a half turn. */
export type FlipStep = 0 | 1 | 2 | 3;

/** What one press of Flip does to what stands: a left-to-right mirror or a half turn. */
export interface FlipTurn extends Orientation { readonly quarters: 0 | 2; readonly mirror: boolean }

/** One press of Flip from `step`: the step it reaches and what it does to what stands there. Each step
 *  is the one before it mirrored left to right or turned a half, alternately, so a press always lays
 *  one of those two and four presses come back to the start. */
export function flipPress(step: FlipStep): { readonly next: FlipStep; readonly turn: FlipTurn } {
  const next = ((step + 1) % 4) as FlipStep;
  return { next, turn: next % 2 === 1 ? { quarters: 0, mirror: true } : { quarters: 2, mirror: false } };
}
