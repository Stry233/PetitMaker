export function hexStringToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** A `#rrggbb` colour as its [r, g, b] channels in 0..255. */
export function hexChannels(hex: string): [number, number, number] {
  const n = hexStringToNumber(hex);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** `0xrrggbb` as [r, g, b] channels in 0..1. */
export function numberToRgb01(n: number): [number, number, number] {
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** Two `0xrrggbb` colours blended per channel, `t` of the way from `a` to `b`. */
export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** The CSS `#rrggbb` form of a numeric colour. */
export function numberToHexString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Rec. 601 luma of three channels, in their own range (0..255 in, 0..255 out). */
export function channelLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** The sRGB transfer function decoded: an encoded channel in 0..1 as linear light in 0..1. */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** The sRGB transfer function encoded: linear light in 0..1 as an encoded channel in 0..1. */
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}
