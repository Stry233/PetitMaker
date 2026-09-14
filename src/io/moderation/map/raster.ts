import type { MapRaster } from './types';

export function rasterCanvas(view: MapRaster): OffscreenCanvas {
  const canvas = new OffscreenCanvas(view.width, view.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(view.pixels), view.width, view.height), 0, 0);
  return canvas;
}

export function crop(source: OffscreenCanvas, x: number, y: number, width: number, height: number, outputWidth: number, mirror = false): OffscreenCanvas {
  const out = new OffscreenCanvas(outputWidth, Math.max(1, Math.round(outputWidth * height / width)));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
  if (mirror) { ctx.translate(out.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, x, y, width, height, 0, 0, out.width, out.height);
  return out;
}
