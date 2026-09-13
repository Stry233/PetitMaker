import type { MapReview, MapReviewRequest } from './types';
import { rasterCanvas } from './raster';

const scope = self as unknown as { onmessage: ((event: MessageEvent<MapReviewRequest>) => void) | null; postMessage: (result: MapReview) => void };
scope.onmessage = async ({ data }) => {
  let unavailable = false;
  try {
    const views = data.views.map(rasterCanvas);
    try {
      const { checkImage } = await import('./image');
      if (await checkImage(views, data.assetBase)) { scope.postMessage({ status: 'blocked', kind: 'image' }); return; }
    } catch { unavailable = true; }
    try {
      const { checkLetters } = await import('./ocr');
      if (await checkLetters(views, data.assetBase)) { scope.postMessage({ status: 'blocked', kind: 'text' }); return; }
    } catch { unavailable = true; }
    scope.postMessage({ status: unavailable ? 'unavailable' : 'clear' });
  } catch { scope.postMessage({ status: 'unavailable' }); }
};
