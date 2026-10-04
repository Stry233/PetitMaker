import type { MapRaster, MapReview } from './types';
export type { MapRaster, MapReview } from './types';
import { createWorkerClient } from '../../../core/runtime/worker-client';

/** Each job owns its inference workers; no map pixels, OCR text or verdicts are persisted. */
export async function reviewMap(views: MapRaster[], signal: AbortSignal): Promise<MapReview> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!views.length || typeof Worker === 'undefined') return { status: 'unavailable' };
  const client = createWorkerClient({
    spawn: () => new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 0,
  });
  const assetBase = new URL(`${import.meta.env.BASE_URL}moderation/`, location.origin).href;
  return client.request<MapReview>({
    message: { views, assetBase },
    transfer: views.map(view => view.pixels.buffer),
    signal,
    // A slow or unsupported device is an incomplete check, never evidence against a map.
    timeoutMs: 5_000,
    fallback: (failure) => {
      if (failure.kind === 'spawn') throw failure.cause;
      return { status: 'unavailable' };
    },
  });
}
