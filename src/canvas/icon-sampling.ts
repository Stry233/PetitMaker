/**
 * Shared icon dominant-colour sampler for BOTH renderers (browser-only). Draws a CanvasImageSource
 * onto a tiny SAMPLE_PX canvas and averages the mid-luminance opaque pixels — skipping the dark
 * hand-drawn outline and the near-white highlights these cartoon icons carry — down to one
 * representative RGB (0..255 components), or null if there is no usable colour.
 *
 * The single source for the tint algorithm the 2D deletion puff (map2d/draw/icon-color) and the 3D
 * poof (map3d/scene/icon-color) both use — they differ only in how they OBTAIN the image (sync Pixi
 * texture source vs async Image load) and how they FORMAT the result (packed int vs 0..1 triple).
 */
const SAMPLE_PX = 24;

export function sampleIconRGB(src: CanvasImageSource): [number, number, number] | null {
  if (typeof document === 'undefined') return null;
  const cnv = document.createElement('canvas');
  cnv.width = SAMPLE_PX; cnv.height = SAMPLE_PX;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(src, 0, 0, SAMPLE_PX, SAMPLE_PX);
    data = ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data;
  } catch { return null; }
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 180) continue;                          // transparent
    const lum = 0.3 * data[i]! + 0.59 * data[i + 1]! + 0.11 * data[i + 2]!;
    if (lum < 45 || lum > 225) continue;                       // outline (dark) / highlight (near-white)
    r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
  }
  return n === 0 ? null : [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
