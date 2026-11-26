/** Load an image URL (data URL or object URL) into an HTMLImageElement. Browser-only. A
 *  `crossOrigin` request keeps a remote picture from tainting the canvas it is drawn on. */
export function loadImage(url: string, opts: { crossOrigin?: 'anonymous' | 'use-credentials' } = {}): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    if (opts.crossOrigin) img.crossOrigin = opts.crossOrigin;
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Image failed to load'));
    img.src = url;
  });
}
