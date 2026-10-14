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
