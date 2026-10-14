/** The document as the browser stencils are drawn and decoded in. */
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
  loadImage: (src) => new Promise<DecodedImage>((resolve, reject) => {
    const img = new Image();
    // Offered art and visitor files are same-origin; a remote source must still not taint the canvas.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`stencil image failed: ${src}`));
    img.src = src;
  }),
};
