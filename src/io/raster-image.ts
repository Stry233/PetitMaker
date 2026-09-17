import { DEFAULT_LIMITS } from './share/errors';
import { deviceCanvasLimits } from './export/canvas-limits';

/** The scale that fits `width` by `height` under the pixel limit and this device's canvas ceiling; 1 when it already fits. */
function fitScale(width: number, height: number): number {
  const device = deviceCanvasLimits();
  const area = Math.min(DEFAULT_LIMITS.maxRasterPixels ?? Infinity, device.maxArea);
  return Math.min(1, Math.sqrt(area / (width * height)), device.maxDim / Math.max(width, height));
}

/** Decodes at native resolution, or smaller when the image is larger than the browser can hold; the
 *  share code is built to survive the resize, and the returned pixel buffer belongs to the caller. */
export async function readRasterImage(file: Blob): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  // A PNG names its size in the header, so an oversized one can be decoded straight to the smaller
  // bitmap without ever holding the full-size pixels.
  let resize: ImageBitmapOptions | undefined;
  if (typeof file.slice === 'function') {
    const header = file.slice(0, 24);
    if (typeof header.arrayBuffer === 'function') {
      let bytes: Uint8Array | undefined;
      try { bytes = new Uint8Array(await header.arrayBuffer()); } catch { /* the image decoder remains authoritative */ }
      const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
      if (bytes?.length === 24 && signature.every((byte, index) => bytes![index] === byte)) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const w = view.getUint32(16), h = view.getUint32(20);
        const scale = fitScale(w, h);
        if (scale < 1) resize = { resizeWidth: Math.max(1, Math.floor(w * scale)), resizeHeight: Math.max(1, Math.floor(h * scale)), resizeQuality: 'high' };
      }
    }
  }
  let source: ImageBitmap | HTMLImageElement;
  let release: () => void;
  try {
    source = resize ? await createImageBitmap(file, resize) : await createImageBitmap(file);
    const bitmap = source;
    release = () => bitmap.close?.();
  } catch {
    const url = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Image decode failed'));
        image.src = url;
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    source = image;
    release = () => { image.src = ''; URL.revokeObjectURL(url); };
  }
  const sourceW = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sourceH = 'naturalHeight' in source ? source.naturalHeight : source.height;
  // A decoder that ignored the resize, or a format without a readable header, is scaled onto the canvas instead.
  const scale = fitScale(sourceW, sourceH);
  const width = Math.max(1, Math.floor(sourceW * scale)), height = Math.max(1, Math.floor(sourceH * scale));
  let canvas: HTMLCanvasElement | undefined;
  try {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(source, 0, 0, width, height);
    release();
    release = () => {};
    const { data } = ctx.getImageData(0, 0, width, height);
    return { pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height };
  } finally {
    release();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
