import { CAPTURE_MATTE } from '../../assets/brand-palette';
import { host } from '../host/host';
import type { MapRaster } from '../../pipelines/moderation';
import { selectedVersion } from '../../state/stylize-versions';
import { useEditorStore } from '../../state/store';

/** The rasters the map check reads: the map, its notes and the selected illustration, detached from
 *  the DOM and without captions, branding or PetitGlyph. */
export async function captureReviewViews(includeIllustration: boolean, includeAnnotations = true): Promise<MapRaster[]> {
  const sources: (HTMLImageElement | ImageBitmap | HTMLCanvasElement)[] = [];
  const map = host.capture2d({ content: 'complete', maxPx: 1200, annotations: includeAnnotations });
  if (!map) throw new Error('Map capture unavailable');
  sources.push(map);
  if (includeAnnotations) {
    const ink = host.capture2d({ content: 'notes', maxPx: 1200 });
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
    ctx.fillStyle = CAPTURE_MATTE; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const raster = { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
    canvas.width = canvas.height = 0;
    return raster;
  });
}
