import type { MapRaster, MapReview } from './types';
export type { MapRaster, MapReview } from './types';
import { createWorkerClient } from '../../../platform/async/worker-client';
import { throwIfAborted } from '../../../platform/async/abort';
import type { MapReviewRequest } from './review.worker';
import { mapCheckAssetBase } from './assets';

/** Each job owns its inference workers; no map pixels, OCR text or verdicts are persisted. */
export async function reviewMap(views: MapRaster[], signal: AbortSignal): Promise<MapReview> {
  throwIfAborted(signal);
  if (!views.length || typeof Worker === 'undefined') return { status: 'unavailable' };
  const client = createWorkerClient<MapReviewRequest, MapReview>({
    spawn: () => new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 0,
  });
  const assetBase = mapCheckAssetBase();
  return client.request({
    message: { views, assetBase },
    transfer: views.map(view => view.pixels.buffer),
    signal,
    // A slow or unsupported device is an incomplete check, never evidence against a map.
    timeoutMs: 5_000,
    fallback: (failure) => {
      // Unlike the text check, the map check has no main-thread path, so a worker that cannot be
      // built rejects; the editor's caller reads any rejection as an unavailable check.
      if (failure.kind === 'spawn') throw failure.cause;
      return { status: 'unavailable' };
    },
  });
}
