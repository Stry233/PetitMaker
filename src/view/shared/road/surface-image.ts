import type { CatalogEntry } from '../../../config/catalog/catalog-entry';
import { surfaceUrl } from '../../../assets/surface-urls';
import type { RoadImagePattern } from '../../../config/catalog/road-material';

interface SurfaceImage {
  canvas: HTMLCanvasElement;
  status: 'loading' | 'ready' | 'failed';
  listeners: Set<() => void>;
  settled: Promise<void>;
}
const SURFACE_TEXTURE_SIZE = 512;
const images = new Map<string, SurfaceImage>();

/** A stable canvas lets both renderers upload decoded art without rebuilding surface geometry. */
export function surfaceImage(pattern: RoadImagePattern, onReady?: () => void): HTMLCanvasElement {
  let entry = images.get(pattern.image);
  if (!entry) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SURFACE_TEXTURE_SIZE;
    entry = { canvas, status: 'failed', listeners: new Set(), settled: Promise.resolve() };
    images.set(pattern.image, entry);
  }
  if (onReady && entry.status !== 'ready') entry.listeners.add(onReady);
  if (entry.status === 'failed') {
    const target = entry, url = surfaceUrl(pattern.image);
    if (!url) return target.canvas;
    target.status = 'loading';
    target.settled = new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        const ctx = target.canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
          ctx.drawImage(image, 0, 0, SURFACE_TEXTURE_SIZE, SURFACE_TEXTURE_SIZE);
          target.status = 'ready';
          const listeners = [...target.listeners];
          target.listeners.clear();
          for (const listener of listeners) listener();
        } else target.status = 'failed';
        resolve();
      };
      image.onerror = () => { target.status = 'failed'; resolve(); };
      image.src = url;
    });
  }
  return entry.canvas;
}

/** Failed images settle too, so export can still complete when an asset is unavailable. */
export function surfaceImageReady(pattern: RoadImagePattern): Promise<void> {
  surfaceImage(pattern);
  return images.get(pattern.image)!.settled;
}

/** Export decodes each distinct surface once, regardless of how many painted cells use it. */
export async function surfaceImagesReady(items: Iterable<CatalogEntry | undefined>): Promise<void> {
  const patterns = new Map<string, RoadImagePattern>();
  for (const item of items) {
    for (const pattern of [item?.surfacePrint, item?.roadMaterial?.edge.pattern, ...(item?.roadMaterial?.layers.map(layer => layer.pattern) ?? [])]) {
      if (typeof pattern === 'object' && pattern.kind === 'image') patterns.set(pattern.image, pattern);
    }
  }
  await Promise.all([...patterns.values()].map(surfaceImageReady));
}
