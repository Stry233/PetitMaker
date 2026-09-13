import { DEFAULT_LIMITS } from './share/errors';

/** Decodes at native resolution; the returned pixel buffer belongs to the caller. */
export async function readRasterImage(file: Blob): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  // PNG dimensions are available before allocating decoded pixels; other formats use the decoder's dimensions.
  if (typeof file.slice === 'function') {
    const header = file.slice(0, 24);
    if (typeof header.arrayBuffer === 'function') {
      let bytes: Uint8Array | undefined;
      try { bytes = new Uint8Array(await header.arrayBuffer()); } catch { /* the image decoder remains authoritative */ }
      const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
      if (bytes?.length === 24 && signature.every((byte, index) => bytes![index] === byte)) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.getUint32(16) * view.getUint32(20) > (DEFAULT_LIMITS.maxRasterPixels ?? Infinity)) throw new Error('Image exceeds pixel limit');
      }
    }
  }
  let source: ImageBitmap | HTMLImageElement;
  let release: () => void;
  try {
    source = await createImageBitmap(file);
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
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (width * height > (DEFAULT_LIMITS.maxRasterPixels ?? Infinity)) throw new Error('Image exceeds pixel limit');
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(source, 0, 0);
    release();
    release = () => {};
    const { data } = ctx.getImageData(0, 0, width, height);
    return { pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height };
  } finally {
    release();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
