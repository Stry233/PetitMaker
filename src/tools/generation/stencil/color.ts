/**
 * Colour arithmetic every stencil reading shares: tone as the eye weighs the channels (Rec. 601
 * weights), and the channel-weighted distance every palette match and threshold is measured in.
 * Colours are packed 0xRRGGBB.
 */
import { channelLuma } from '../../../core/base/color';

/** Brightness of a packed colour, 0..255. The one measure of tone the stencil works in. */
export function luma(rgb: number): number {
  return channelLuma((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
}

/** Squared channel-weighted distance between two packed colours; orders matches without a root. */
export function colorDistanceSq(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
}

/** Channel-weighted Euclidean distance between two packed colours, in luma units. */
export function colorDistance(a: number, b: number): number {
  return Math.sqrt(colorDistanceSq(a, b));
}

/** A colour reduced to five bits a channel: near-identical shades share a bucket, which is what
 *  makes a count of "how many colours is this drawn in" survive a JPEG's noise or a scaler's
 *  blending. */
export function colorBucket(r: number, g: number, b: number): number {
  return (((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)) >>> 0;
}

/** Chroma below which a colour reads as grey: it has no hue to match or to offset. */
export const HUE_CHROMA_MIN = 16;

/** Hue in degrees and chroma as the channel spread — enough of HSV for "is this a different colour,
 *  or the same colour darker". */
export function hueOf(rgb: number): { hue: number; chroma: number } {
  const r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min;
  if (c === 0) return { hue: 0, chroma: 0 };
  const h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return { hue: ((h * 60) % 360 + 360) % 360, chroma: c };
}

/** The turn from `from` to `to`, signed, in (-180, 180]. */
export function signedTurn(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/** Per-channel interpolation; weights zero and one return the endpoints exactly. */
export function blendColor(from: number, to: number, weight: number): number {
  if (weight <= 0) return from;
  if (weight >= 1) return to;
  const mix = (shift: number): number => {
    const a = (from >> shift) & 0xff, b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * weight);
  };
  return ((mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
}

/** The nearest entry of a palette to a colour, and how far off it is (channel-weighted, not squared). */
export function nearestEntry(
  entries: readonly { rgb: number }[], rgb: number,
): { at: number; off: number } {
  let at = -1, best = Infinity;
  for (const [index, entry] of entries.entries()) {
    const d = colorDistanceSq(entry.rgb, rgb);
    if (d < best) { best = d; at = index; }
  }
  return { at, off: at < 0 ? Infinity : Math.sqrt(best) };
}

/** Finds the nearest chromatic palette entry within `maxTurn` degrees of the source hue. */
export function hueMatched(
  entries: readonly { rgb: number }[], rgb: number, maxTurn: number,
): { at: number; off: number } | null {
  const own = hueOf(rgb);
  let at = -1, best = Infinity;
  for (const [index, entry] of entries.entries()) {
    const theirs = hueOf(entry.rgb);
    if (theirs.chroma < HUE_CHROMA_MIN) continue;
    if (Math.abs(signedTurn(own.hue, theirs.hue)) > maxTurn) continue;
    const d = colorDistanceSq(entry.rgb, rgb);
    if (d < best) { best = d; at = index; }
  }
  return at < 0 ? null : { at, off: Math.sqrt(best) };
}
