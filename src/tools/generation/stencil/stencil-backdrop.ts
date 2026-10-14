/** Which pixels of a decoded picture are a flat backdrop rather than the picture. */
import { colorBucket, colorDistance } from './color';
import { floodFrom } from '../../../core/grid/cell-sets';
import type { SourcePixels } from './stencil-sample';

/** How close a pixel has to be to the backdrop's colour to be part of it. Wide enough for a JPEG's
 *  noise and a watermark's faint pattern over a white field, narrow enough that a subject drawn in a
 *  neighbouring shade is not swallowed. */
const BACKGROUND_TOLERANCE = 30;
/** How much of the picture's own border the backdrop has to hold before there is one at all. */
const BACKGROUND_BORDER_SHARE = 0.6;
/** And how much of the whole picture. */
const BACKGROUND_MIN_SHARE = 0.15;
/**
 * How deep it has to be, as a share of the picture's shorter side.
 *
 * A backdrop is a field the subject sits in; a drawn outline around a sticker is also one colour,
 * also touches every edge and can also be a sixth of the picture, and it is part of the drawing.
 * What tells them apart is thickness: erode the flooded region by this much and a backdrop still has
 * an inside while a rim is gone. A share of the side rather than a count of pixels, so it means the
 * same thing at any resolution.
 */
const BACKGROUND_MIN_DEPTH = 0.05;
/**
 * How much must survive the flood: the subject it leaves must outlast this many erosions. The other
 * gates measure the field, and a flat tile passes all of them while its flood keys out the whole
 * picture. Two rather than the field's own depth, since a subject may be thin: the stones of a stone
 * path survive two erosions and not six.
 */
const BACKGROUND_MIN_SUBJECT_DEPTH = 2;

/**
 * Which source pixels are a flat backdrop rather than the picture, or null when there is none. A
 * cut-out PNG says this with alpha; a pasted JPEG or screenshot says it with a wall of white, which
 * matched to a palette paves the region and hides the silhouette that carries a small picture.
 *
 * Read at source resolution: on the cell grid a drawn outline is about a cell wide and the flood
 * leaks through it into the subject's own white. The backdrop is reached only from the border, and
 * gates keep it from firing on a picture without one: the border is genuinely one colour, the flood
 * reaches a real share, a pixel joins by distance to the backdrop rather than its neighbour (so a
 * gradient cannot be walked), and what is left must be a subject (`BACKGROUND_MIN_SUBJECT_DEPTH`).
 */
export function backgroundMask(src: SourcePixels): Uint8Array | null {
  const { width: w, height: h } = src;
  if (w < 2 || h < 2) return null;
  const rgbAt = (i: number): number =>
    ((src.data[i * 4]! << 16) | (src.data[i * 4 + 1]! << 8) | src.data[i * 4 + 2]!) >>> 0;
  const opaque = (i: number): boolean => src.data[i * 4 + 3]! >= 128;

  const border: number[] = [];
  for (let x = 0; x < w; x++) { border.push(x); border.push((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { border.push(y * w); border.push(y * w + w - 1); }
  const onBorder = border.filter(opaque);
  if (onBorder.length === 0) return null;

  // The border's commonest colour, as the mean of the pixels that voted for it — the bucket's own
  // centre would be up to four levels off in every channel.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const i of onBorder) {
    const rgb = rgbAt(i);
    const key = colorBucket((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
    const bucket = buckets.get(key);
    if (bucket) { bucket.n++; bucket.r += (rgb >> 16) & 0xff; bucket.g += (rgb >> 8) & 0xff; bucket.b += rgb & 0xff; }
    else buckets.set(key, { n: 1, r: (rgb >> 16) & 0xff, g: (rgb >> 8) & 0xff, b: rgb & 0xff });
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  let bestKey = Infinity;
  for (const [key, bucket] of buckets) {
    if (!best || bucket.n > best.n || (bucket.n === best.n && key < bestKey)) { best = bucket; bestKey = key; }
  }
  if (!best) return null;
  const backdrop = ((Math.round(best.r / best.n) << 16) | (Math.round(best.g / best.n) << 8) | Math.round(best.b / best.n)) >>> 0;

  // Which pixels could belong to the backdrop, answered once for the whole picture. The flood asks
  // this of every pixel it reaches from each of its four sides, so a per-call test measured the same
  // colour distance about four times over.
  const near = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (opaque(i) && colorDistance(rgbAt(i), backdrop) <= BACKGROUND_TOLERANCE) near[i] = 1;
  }
  const seeds = onBorder.filter((i) => near[i] === 1);
  if (seeds.length / onBorder.length < BACKGROUND_BORDER_SHARE) return null;

  const mask = floodFrom(seeds, (i) => near[i] === 1, w, h);
  let found = 0;
  for (let i = 0; i < w * h; i++) found += mask[i]!;
  let drawn = 0;
  for (let i = 0; i < w * h; i++) if (opaque(i)) drawn++;
  if (drawn === 0 || found / drawn < BACKGROUND_MIN_SHARE) return null;
  if (!hasDepth(mask, w, h, Math.max(2, Math.round(BACKGROUND_MIN_DEPTH * Math.min(w, h))))) return null;
  const subject = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) subject[i] = opaque(i) && !mask[i] ? 1 : 0;
  return hasDepth(subject, w, h, BACKGROUND_MIN_SUBJECT_DEPTH) ? mask : null;
}

/**
 * Whether anything of `mask` survives being eroded `depth` times — a region with an inside, as
 * opposed to a band that is all edge.
 *
 * Asked as a distance, not as `depth` erosions. What an erosion counts down is how far a pixel sits
 * from the nearest one the mask does not hold (the picture's own edge counting as one of those), so a
 * pixel survives k erosions exactly while that distance exceeds k. Two chamfer passes give every
 * pixel its distance at once, where eroding the whole mask a step at a time re-walked the source
 * `depth` times over — and depth is a share of the source's own side, so a 500-pixel picture asked
 * for twenty-five walks of itself.
 */
function hasDepth(mask: Uint8Array, w: number, h: number, depth: number): boolean {
  const dist = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const up = y > 0 ? dist[i - w]! : 0;
      const left = x > 0 ? dist[i - 1]! : 0;
      dist[i] = Math.min(up, left) + 1;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const down = y < h - 1 ? dist[i + w]! : 0;
      const right = x < w - 1 ? dist[i + 1]! : 0;
      const own = Math.min(dist[i]!, Math.min(down, right) + 1);
      if (own > depth) return true;
      dist[i] = own;
    }
  }
  return false;
}
