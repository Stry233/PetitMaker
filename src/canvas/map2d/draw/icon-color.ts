import * as PIXI from 'pixi.js-legacy';
import { sampleIconRGB } from '../../icon-sampling';

const _iconTexCache = new Map<string, PIXI.Texture>();
/** Full-size source texture per icon URL — the LOD cache above keys by `url@bucket`,
 *  so colour sampling needs its own url-keyed handle to the loaded image. */
const _iconBaseByUrl = new Map<string, PIXI.Texture>();

/** Stepped-halving downscale: repeatedly halve on a canvas until <= 2x target,
 *  then draw at target with high-quality smoothing. One box-filter step per
 *  octave beats a single big GPU/canvas downscale (no shimmer, no mush) and
 *  works identically on WebGL1/Canvas2D where npot mipmaps are unavailable. */
function steppedDownscale(img: HTMLImageElement | HTMLCanvasElement, target: number): HTMLCanvasElement {
  let src: HTMLImageElement | HTMLCanvasElement = img;
  let w = src.width, h = src.height;
  const scale = target / Math.max(w, h);
  while (Math.max(w, h) > target * 2) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w / 2)); c.height = Math.max(1, Math.round(h / 2));
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    src = c; w = c.width; h = c.height;
  }
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(img.width * scale));
  out.height = Math.max(1, Math.round(img.height * scale));
  const g = out.getContext('2d')!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/**
 * Icon texture at a display LOD. `targetPx` = the sprite's on-screen budget in
 * DEVICE px (box size x renderer resolution x a zoom headroom); it is bucketed
 * to powers of two so a handful of LODs serve every zoom. Sources are usually
 * much larger than their map footprint — pre-downscaling with stepped halving
 * keeps 4K fit-to-map views crisp where raw LINEAR (or trilinear between far
 * mip levels) reads blurry. Falls back to the raw texture until the image
 * loads (the sprite re-fits via baseTexture 'loaded' as before).
 */
/** Bumped whenever an icon's cache entry is ASYNC-swapped to its downscaled LOD texture (image
 *  decode lands after getIconTexture returned the raw fallback). Skip-if-unchanged consumers
 *  (ObjectLayer.updateLod) must include this in their gate or they pin the raw texture forever. */
let _iconLodVersion = 0;
export function iconLodVersion(): number { return _iconLodVersion; }

export function getIconTexture(url: string, targetPx = 256): PIXI.Texture {
  const bucket = Math.min(1024, Math.max(64, 2 ** Math.ceil(Math.log2(targetPx))));
  const key = `${url}@${bucket}`;
  let tex = _iconTexCache.get(key);
  if (!tex) {
    const raw = PIXI.Texture.from(url);
    _iconBaseByUrl.set(url, raw);
    raw.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
    raw.baseTexture.anisotropicLevel = 8;
    raw.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    tex = raw;
    const swap = () => {
      const src = (raw.baseTexture.resource as { source?: CanvasImageSource }).source;
      if (!(src instanceof HTMLImageElement) || Math.max(src.width, src.height) <= bucket * 1.25) return;
      const lod = PIXI.Texture.from(steppedDownscale(src, bucket));
      lod.baseTexture.mipmap = PIXI.MIPMAP_MODES.ON;
      lod.baseTexture.anisotropicLevel = 8;
      _iconTexCache.set(key, lod);
      _iconLodVersion++; // callers caching getIconTexture results re-fetch on the next LOD pass
    };
    if (raw.baseTexture.valid) swap();
    else raw.baseTexture.once('loaded', () => { swap(); });
    _iconTexCache.set(key, tex);
  }
  return tex;
}

/**
 * The representative body color of an icon, for tinting its place/delete puff so
 * the particles read as that object's hue. Averages mid-tone opaque pixels
 * (skipping the dark outline + white highlights these cartoon icons carry) from
 * the already-loaded texture image, drawn small onto a canvas. Cached per URL;
 * returns null until the texture image is ready (caller falls back to a default).
 */
const _iconColorCache = new Map<string, number | null>();
export function iconColor(url: string): number | null {
  const cached = _iconColorCache.get(url);
  if (cached !== undefined) return cached;
  const tex = _iconBaseByUrl.get(url);
  const src = tex?.baseTexture.valid ? (tex.baseTexture.resource as { source?: CanvasImageSource }).source : undefined;
  if (!src) return null; // not loaded yet — don't cache; retry on the next emit
  const rgb = sampleIconRGB(src);
  const color = rgb ? ((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) : null;
  _iconColorCache.set(url, color);
  return color;
}
