/*
 * oklab.ts — the colour space a procedural pack authors in.
 *
 * Packs declare VALUE first and hue second, because the failure this whole module exists to avoid
 * is a value failure: the shipped map palette holds no lightness below OKLab L 0.49, and its water
 * sits 0.013 from its lowland green, so the two read as one mass at thumbnail size. A pack that
 * picked colours by eye in sRGB would reproduce that. Working in OKLab makes "a real dark exists"
 * and "the road clears its ground" checkable rather than hoped for.
 */

export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(c: Rgb): string {
  return `#${c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const toSrgb = (v: number): number =>
  255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function rgbToOklab(rgb: Rgb): Lab {
  const r = toLinear(rgb[0]);
  const g = toLinear(rgb[1]);
  const b = toLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgbRaw(lab: Lab): Rgb {
  const [L, A, B] = lab;
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const inGamut = (c: Rgb): boolean => c.every((v) => v >= -0.5 && v <= 255.5);

/** Out-of-gamut colours lose CHROMA, never lightness or hue: a pack's value plan is the thing that
 *  must survive, and a hue shift is the one error a viewer names as wrong. */
export function oklabToRgb(lab: Lab): Rgb {
  const L = clamp(lab[0], 0, 1);
  const direct = oklabToRgbRaw([L, lab[1], lab[2]]);
  if (inGamut(direct)) return direct.map((v) => clamp(v, 0, 255)) as unknown as Rgb;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const t = (lo + hi) / 2;
    if (inGamut(oklabToRgbRaw([L, lab[1] * t, lab[2] * t]))) lo = t;
    else hi = t;
  }
  return oklabToRgbRaw([L, lab[1] * lo, lab[2] * lo]).map((v) => clamp(v, 0, 255)) as unknown as Rgb;
}

export type Lch = readonly [number, number, number];
export const labToLch = (lab: Lab): Lch => [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
export const lchToLab = (lch: Lch): Lab => [lch[0], lch[1] * Math.cos(lch[2]), lch[1] * Math.sin(lch[2])];

export const hexToLch = (hex: string): Lch => labToLch(rgbToOklab(hexToRgb(hex)));
export const lchToHex = (lch: Lch): string => rgbToHex(oklabToRgb(lchToLab(lch)));

/** Lightness of a hex colour. The number every pack assertion is written against. */
export const lightness = (hex: string): number => rgbToOklab(hexToRgb(hex))[0];

export interface ColorMove {
  /** Absolute lightness. */
  L?: number;
  /** Absolute chroma. */
  C?: number;
  /** Absolute hue, radians. */
  h?: number;
  /** Lightness delta, applied after any absolute L. */
  dL?: number;
  /** Chroma multiplier. */
  kC?: number;
  /** Hue delta, radians. */
  dh?: number;
}

/** Move a colour in OKLCh. Any field omitted is kept, so a pack can restate value alone. */
export function reColor(hex: string, move: ColorMove): string {
  const [l, c, h] = hexToLch(hex);
  const L = clamp((move.L ?? l) + (move.dL ?? 0), 0, 1);
  const C = Math.max(0, (move.C ?? c) * (move.kC ?? 1));
  return lchToHex([L, C, (move.h ?? h) + (move.dh ?? 0)]);
}

/** Interpolate perceptually. An sRGB average of two saturated colours passes through grey; this
 *  does not, which is why every blend in a pack goes through here. */
export function mixHex(a: string, b: string, t: number): string {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  return rgbToHex(oklabToRgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]));
}

export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
