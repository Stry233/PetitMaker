/*
 * idle-warm.ts — decode the catalog icons ahead of the first shelf open.
 *
 * The splash (or an earlier session) puts the BYTES in the HTTP cache, but bytes are not pixels:
 * the first object-shelf open still paid ~80 PNG decodes in one burst, which read as a beat of
 * blank cards popping in together. This warms the browser's image-decode cache during idle time
 * after boot, a few images at a time, so the shelf's first paint draws already-decoded art.
 *
 * Best-effort by design: decode-cache entries can be evicted, failures are ignored, and the loop
 * yields to idle callbacks so it never competes with interaction. It touches only catalog icons —
 * the set a panel shows wholesale; chrome art is on screen from boot and needs no warming.
 */
import { allIconUrls } from '../../../assets/icon-urls';

const DECODE_BATCH = 3;

let started = false;

export function warmIconDecodes(): void {
  if (started || typeof document === 'undefined' || typeof Image === 'undefined') return;
  started = true;
  const queue = allIconUrls().filter((url) => !url.startsWith('data:'));
  const idle = (cb: () => void): void => {
    if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback(cb: () => void): number }).requestIdleCallback(cb);
    else setTimeout(cb, 200);
  };
  const decodeOne = async (url: string): Promise<void> => {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      // A failed decode on a same-origin PNG usually means a TRUNCATED cache entry — the remains
      // of a download a reload cut short (Firefox logs it as "Image corrupt or truncated").
      // Refetch past the cache to replace the entry, then decode the healthy copy.
      try {
        await fetch(url, { cache: 'reload' });
        const retry = new Image();
        retry.src = url;
        await retry.decode();
      } catch { /* offline or genuinely broken — the shelf's own <img> will retry on view */ }
    }
  };
  const step = (): void => {
    const batch = queue.splice(0, DECODE_BATCH);
    if (batch.length === 0) return;
    void Promise.all(batch.map(decodeOne)).then(() => idle(step));
  };
  idle(step);
}

/** Test hook. */
export function resetIdleWarmForTest(): void {
  started = false;
}
