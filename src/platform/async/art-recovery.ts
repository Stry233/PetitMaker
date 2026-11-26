import { holdFailedImage, imagesHeld, onImageHeld, retryHeldImages } from './art-retry';

/** Waits between retries while pictures keep failing, widening to the last. */
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000] as const;
/** Marks a picture on the page whose load failed; the Lite shell's stylesheet draws its placeholder. */
const MISSING = 'data-art-missing';

/**
 * Recovers the package's pictures the Xiaohongshu container serves from afar, which can fail
 * offline: a failed picture on the page shows a placeholder, and every held picture, map art
 * included, loads again when the connection returns, when the page comes back to the front, and at
 * widening intervals meanwhile. Returns the uninstall.
 */
export function installArtRecovery(): () => void {
  const packaged = new URL('./', document.baseURI).href;
  let step = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const retry = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    retryHeldImages();
  };
  const schedule = (): void => {
    if (timer !== null || !imagesHeld()) return;
    timer = setTimeout(() => {
      timer = null;
      step = Math.min(step + 1, RETRY_DELAYS_MS.length - 1);
      retryHeldImages();
    }, RETRY_DELAYS_MS[step]);
  };
  // A picture's load and error events reach the document's capture phase but never the window's.
  const failed = (event: Event): void => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.src.startsWith(packaged)) return;
    image.setAttribute(MISSING, '');
    holdFailedImage(image, () => image.isConnected);
  };
  const loaded = (event: Event): void => {
    if (event.target instanceof HTMLImageElement && event.target.hasAttribute(MISSING)) event.target.removeAttribute(MISSING);
  };
  const online = (): void => {
    step = 0;
    if (imagesHeld()) retry();
  };
  const shown = (): void => {
    if (!document.hidden && imagesHeld()) retry();
  };
  document.addEventListener('error', failed, true);
  document.addEventListener('load', loaded, true);
  window.addEventListener('online', online);
  document.addEventListener('visibilitychange', shown);
  const unsubscribe = onImageHeld(schedule);
  return () => {
    document.removeEventListener('error', failed, true);
    document.removeEventListener('load', loaded, true);
    window.removeEventListener('online', online);
    document.removeEventListener('visibilitychange', shown);
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
  };
}
