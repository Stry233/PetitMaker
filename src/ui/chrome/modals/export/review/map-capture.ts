import { host } from '../../../../../kit/host';
import type { MapRaster } from '../../../../../io/moderation/map/types';
import { selectedVersion } from '../stylize/use-stylize-versions';
import { useEditorStore } from '../../../../../state/store';

/** Analysis images stay detached from the DOM and exclude captions, branding and PetitGlyph. */
export async function captureReviewViews(includeIllustration: boolean, includeAnnotations = true): Promise<MapRaster[]> {
  const sources: (HTMLImageElement | ImageBitmap | HTMLCanvasElement)[] = [];
  const map = host.captureComplete2dCanvas(1200, includeAnnotations);
  if (!map) throw new Error('Map capture unavailable');
  sources.push(map);
  if (includeAnnotations) {
    const ink = host.capture2dAnnotationsCanvas(1200);
    if (!ink && useEditorStore.getState().gridState?.annotations?.items.length) throw new Error('Annotation capture unavailable');
    if (ink) sources.push(ink);
  }
  const version = includeIllustration ? selectedVersion() : null;
  if (version) sources.push(version.image);
  return sources.map(source => {
    const scale = Math.min(1, 1200 / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const raster = { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
    canvas.width = canvas.height = 0;
    return raster;
  });
}
