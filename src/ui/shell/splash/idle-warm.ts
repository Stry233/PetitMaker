/** The catalog icons warmed in small idle batches on visits that skip the splash; the decode and
 *  its cache repair are `platform/async/http-cache.ts:decodeImage`, which the splash shares. */
import { allIconUrls } from '../../../assets/icon-urls';
import { decodeImage } from '../../../platform/async/http-cache';

const DECODE_BATCH = 3;
let started = false;

/** Warm cached catalog pixels in small idle batches on visits that skip the splash. */
export function warmIconDecodes(): void {
  if (started || typeof document === 'undefined' || typeof Image === 'undefined') return;
  started = true;
  const queue = allIconUrls().filter((url) => !url.startsWith('data:'));
  const idle = (cb: () => void): void => {
    if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback(cb: () => void): number }).requestIdleCallback(cb);
    else setTimeout(cb, 200);
  };
  const step = (): void => {
    const batch = queue.splice(0, DECODE_BATCH);
    if (batch.length === 0) return;
    void Promise.all(batch.map(decodeImage)).then(() => idle(step));
  };
  idle(step);
}
