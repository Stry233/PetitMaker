import type { MapRaster, MapReview } from './types';
import { rasterCanvas } from './raster';
import { workerScope } from '../../../platform/async/worker-client';

/** The map's rendered views, transferred, and the base URL the check models load from. */
export type MapReviewRequest = { views: MapRaster[]; assetBase: string };
/** The verdict, preceded by any number of `working` messages that say the check is still moving. */
export type MapReviewReply = MapReview | { status: 'working' };

/** The least time between two `working` messages, in ms. */
const PROGRESS_MS = 250;

const scope = workerScope<MapReviewRequest, MapReviewReply>();
let reported = 0;
const progress = () => {
  const now = performance.now();
  if (now - reported < PROGRESS_MS) return;
  reported = now;
  scope.post({ status: 'working' });
};
scope.listen(async (data) => {
  let unavailable = false;
  try {
    const views = data.views.map(rasterCanvas);
    try {
      const { checkImage } = await import('./image');
      progress();
      if (await checkImage(views, data.assetBase, progress)) { scope.post({ status: 'blocked', kind: 'image' }); return; }
    } catch { unavailable = true; }
    try {
      const { checkLetters } = await import('./ocr');
      progress();
      const letters = await checkLetters(views, data.assetBase, progress);
      if (letters === 'blocked') { scope.post({ status: 'blocked', kind: 'text' }); return; }
      if (letters === 'unavailable') unavailable = true;
    } catch { unavailable = true; }
    scope.post({ status: unavailable ? 'unavailable' : 'clear' });
  } catch { scope.post({ status: 'unavailable' }); }
});
