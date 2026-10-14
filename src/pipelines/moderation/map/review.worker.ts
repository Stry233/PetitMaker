import type { MapRaster, MapReview } from './types';
import { rasterCanvas } from './raster';
import { workerScope } from '../../../platform/async/worker-client';

/** The map's rendered views, transferred, and the base URL the check models load from. */
export type MapReviewRequest = { views: MapRaster[]; assetBase: string };

const scope = workerScope<MapReviewRequest, MapReview>();
scope.listen(async (data) => {
  let unavailable = false;
  try {
    const views = data.views.map(rasterCanvas);
    try {
      const { checkImage } = await import('./image');
      if (await checkImage(views, data.assetBase)) { scope.post({ status: 'blocked', kind: 'image' }); return; }
    } catch { unavailable = true; }
    try {
      const { checkLetters } = await import('./ocr');
      const letters = await checkLetters(views, data.assetBase);
      if (letters === 'blocked') { scope.post({ status: 'blocked', kind: 'text' }); return; }
      if (letters === 'unavailable') unavailable = true;
    } catch { unavailable = true; }
    scope.post({ status: unavailable ? 'unavailable' : 'clear' });
  } catch { scope.post({ status: 'unavailable' }); }
});
