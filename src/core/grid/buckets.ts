import type { BucketCoord } from '../base/coords';

/** Cells on each side of a storage bucket, the zero-aligned unit renderers and indexes cull and
 *  remesh by. An engine unit: the game's own chunk (`CHUNK_SIZE`, counted from a map's chunk
 *  origin) is a separate fact. */
export const BUCKET_SIZE = 16;

/** The bucket holding cell (x, y). */
export function bucketOf(x: number, y: number): BucketCoord {
  return { cx: Math.floor(x / BUCKET_SIZE), cy: Math.floor(y / BUCKET_SIZE) } as BucketCoord;
}

/** Bucket columns and rows covering a `width` x `height` map. */
export function bucketCounts(width: number, height: number): { cols: number; rows: number } {
  return { cols: Math.ceil(width / BUCKET_SIZE), rows: Math.ceil(height / BUCKET_SIZE) };
}

/** The cells bucket (cx, cy) covers on a `width` x `height` map: x in [x0, x1), y in [y0, y1). */
export function bucketSpan(cx: number, cy: number, width: number, height: number): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = cx * BUCKET_SIZE, y0 = cy * BUCKET_SIZE;
  return { x0, y0, x1: Math.min(x0 + BUCKET_SIZE, width), y1: Math.min(y0 + BUCKET_SIZE, height) };
}
