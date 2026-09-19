import { allIconUrls } from '../../../assets/icon-urls';

const DECODE_BATCH = 3;
const decoded = new Map<string, Promise<boolean>>();
let started = false;

async function loadImage(url: string): Promise<void> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = url;
  });
  // Older browsers finish at load; a missing decode API does not mean a corrupt cache entry.
  if (typeof img.decode === 'function') await img.decode();
}

/** Splash and idle warming share one decode, including at most one cache repair per URL. */
export function decodeIcon(url: string): Promise<boolean> {
  let job = decoded.get(url);
  if (!job) {
    job = (async () => {
      try { await loadImage(url); return true; }
      catch {
        // Interrupted downloads can leave truncated HTTP-cache entries.
        try {
          const response = await fetch(url, { cache: 'reload' });
          if (!response.ok) return false;
          await response.blob();
          await loadImage(url);
          return true;
        } catch { return false; }
      }
    })();
    decoded.set(url, job);
  }
  return job;
}

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
    void Promise.all(batch.map(decodeIcon)).then(() => idle(step));
  };
  idle(step);
}

/** Test hook. */
export function resetIdleWarmForTest(): void {
  started = false;
  decoded.clear();
}
