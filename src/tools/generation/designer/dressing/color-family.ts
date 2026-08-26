/**
 * A plant's COLOUR FAMILY, derived from its 3D model.
 *
 * The catalog carries no colour field for flora or trees, so "what colour is this flower" has to be
 * read off the item's `model3d`: the hue family of the largest-volume part that is neither foliage
 * green nor trunk brown. It is the same definition palette unity is measured with on the reference
 * maps, kept here so the scorer and the kits agree on one answer. A later pass may replace the
 * derivation with an authored table; the signature is what callers hold.
 */
import { getCatalogItem } from '../../../../state/catalog';

/** Coarse hue name for an sRGB hex colour. Neutrals answer white / grey / black. */
export function hueFamily(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'unknown';
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (d < 0.09) return l > 0.75 ? 'white' : l < 0.22 ? 'black' : 'grey';
  let h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  const s = d / (1 - Math.abs(2 * l - 1));
  if (h < 15 || h >= 340) return 'red';
  if (h < 40) return l < 0.5 && s < 0.7 ? 'brown' : 'orange';
  if (h < 70) return 'yellow';
  if (h < 160) return 'green';
  if (h < 200) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

const cache = new Map<string, string>();

/** The colour family of a catalog plant. 'green' for an all-foliage plant, 'unknown' with no model. */
export function colorFamily(catalogId: string): string {
  const hit = cache.get(catalogId);
  if (hit !== undefined) return hit;
  const parts = getCatalogItem(catalogId)?.model3d?.parts;
  let out = 'unknown';
  if (parts && parts.length) {
    const volume = new Map<string, number>();
    for (const p of parts) {
      const v = Math.abs(p.size[0] * p.size[1] * p.size[2]);
      volume.set(p.color, (volume.get(p.color) ?? 0) + v);
    }
    let best = '', bestVolume = -1;
    for (const [hex, v] of volume) {
      const fam = hueFamily(hex);
      if (fam === 'green' || fam === 'brown') continue; // foliage and trunk are not the plant's colour
      if (v > bestVolume) { bestVolume = v; best = hex; }
    }
    out = best ? hueFamily(best) : 'green';
  }
  cache.set(catalogId, out);
  return out;
}
