import type { MapRaster, MapReview } from './types';
export type { MapRaster, MapReview } from './types';

/** Each job owns its inference workers; no map pixels, OCR text or verdicts are persisted. */
export async function reviewMap(views: MapRaster[], signal: AbortSignal): Promise<MapReview> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  if (!views.length || typeof Worker === 'undefined') return { status: 'unavailable' };
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./review.worker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (result?: MapReview) => {
      if (finished) return;
      finished = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate();
      if (result) resolve(result); else reject(new DOMException('Cancelled', 'AbortError'));
    };
    const abort = () => finish();
    // A slow or unsupported device is an incomplete check, never evidence against a map.
    const timeout = setTimeout(() => finish({ status: 'unavailable' }), 5_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<MapReview>) => finish(data);
    worker.onerror = () => finish({ status: 'unavailable' });
    worker.onmessageerror = () => finish({ status: 'unavailable' });
    const assetBase = new URL(`${import.meta.env.BASE_URL}moderation/`, location.origin).href;
    try { worker.postMessage({ views, assetBase }, views.map(view => view.pixels.buffer)); }
    catch { finish({ status: 'unavailable' }); }
  });
}
