/**
 * Async icon dominant-colour extraction for the 3D preview (browser-only).
 *
 * Loads an icon PNG, then hands it to the shared sampleIconRGB (canvas/icon-sampling) — the same
 * mid-luminance averaging the 2D deletion puff uses. This file owns only the ASYNC image load +
 * the 0..1 normalization (the palette convention); the sampling algorithm lives in one place.
 *
 * Returns sRGB components in 0..1, or null if the icon has no usable colour / fails to load.
 * Results are cached per URL.
 */
import { sampleIconRGB } from '../../icon-sampling';

type Rgb = [number, number, number];

const cache = new Map<string, Promise<Rgb | null>>();

export function iconDominantColor(url: string): Promise<Rgb | null> {
  const cached = cache.get(url);
  if (cached) return cached;

  const p = new Promise<Rgb | null>((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const rgb = sampleIconRGB(img);
      resolve(rgb ? [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255] : null);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });

  cache.set(url, p);
  return p;
}
