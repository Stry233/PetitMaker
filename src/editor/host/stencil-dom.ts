/** The document as the browser stencils are drawn and decoded in. */
import { loadImage } from '../../platform/async/load-image';
import type { DecodedImage, StencilBrowser } from '../../tools/generation/stencil';

export const DOM_STENCIL_BROWSER: StencilBrowser = {
  canvas(width, height) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext('2d', { willReadFrequently: true });
  },
  fonts: () => (typeof document !== 'undefined' ? document.fonts ?? null : null),
  // Offered art and visitor files are same-origin; a remote source must still not taint the canvas.
  loadImage: (src): Promise<DecodedImage> => loadImage(src, { crossOrigin: 'anonymous' }).catch((): never => { throw new Error(`stencil image failed: ${src}`); }),
};
