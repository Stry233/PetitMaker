/** Cold visits warm interface art and font faces before the splash hands off to the editor. */
import { activeTarget } from '../../../platform/build/deploy-targets';
import { allIconUrls } from '../../../assets/icon-urls';
import { FONT_FACES } from '../../../assets/fonts/family';
import { cacheHolds, decodeImage, fetchIntoCache } from '../../../platform/async/http-cache';
import { startWarm } from '../warm/schedule';

/** Every shipped face, including weights not visible in the initial frame. */
const FONT_LOADS = FONT_FACES.flatMap(({ family, weights }) => weights.map(weight => `${weight} 16px "${family}"`));

const FETCH_POOL = 8;

type Progress = (done: number, total: number) => void;

/** One preload per page, multiplexed: React's dev StrictMode mounts the splash twice, and the
 *  remount must attach to the run already in flight (getting the current count at once) rather
 *  than starting a second sweep or, worse, being the run nobody finishes. */
let inflight: Promise<boolean> | null = null;
const subscribers = new Set<Progress>();
let lastDone = 0;
let lastTotal = 0;

/**
 * Fetch everything, reporting `(done, total)` after each settled item. Fonts and the warm schedule's
 * counted items (lazy chunks and first-use files) count as items too. Resolves whether all art and
 * fonts completed successfully within the warmup deadline; never rejects. The warm schedule keeps
 * running past the deadline, and its failures never make a later visit show the splash again.
 */
export function preloadAssets(onProgress: Progress, signal?: AbortSignal): Promise<boolean> {
  if (!signal?.aborted) subscribers.add(onProgress);
  const unsubscribe = () => subscribers.delete(onProgress);
  signal?.addEventListener('abort', unsubscribe, { once: true });
  if (lastTotal > 0 && !signal?.aborted) onProgress(lastDone, lastTotal);
  inflight ??= runPreload();
  return inflight.finally(() => {
    unsubscribe();
    signal?.removeEventListener('abort', unsubscribe);
  });
}

async function runPreload(): Promise<boolean> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  // Whether the art and fonts completed, once they have settled: the deadline releases the splash
  // with that answer while the warm schedule carries on.
  let artComplete: boolean | null = null;
  const expired = new Promise<boolean>(resolve => {
    timeout = setTimeout(() => { controller.abort(); resolve(artComplete ?? false); }, 30_000);
  });
  const work = async (): Promise<boolean> => {
    const { splashAssetUrls } = await import('./asset-list');
    if (controller.signal.aborted) return false;
    const urls = splashAssetUrls();
    const icons = new Set(allIconUrls());
    const fonts = typeof document !== 'undefined' && typeof (document.fonts as FontFaceSet | undefined)?.load === 'function' ? FONT_LOADS : [];
    const warm = startWarm();
    await warm.planned;
    if (controller.signal.aborted) return false;
    lastTotal = urls.length + fonts.length + warm.total();
    lastDone = warm.done();
    let complete = true;
    const settle = (): void => {
      if (controller.signal.aborted) return;
      lastDone++;
      for (const sub of subscribers) sub(lastDone, lastTotal);
    };
    const unsubscribeWarm = warm.subscribe(settle);
    controller.signal.addEventListener('abort', unsubscribeWarm, { once: true });
    const fontWork = Promise.all(fonts.map(async face => {
      try { await document.fonts.load(face); } catch { complete = false; }
      settle();
    }));
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (!controller.signal.aborted && cursor < urls.length) {
        const url = urls[cursor++]!;
        if (!await fetchIntoCache(url, controller.signal)) complete = false;
        else if (!controller.signal.aborted && icons.has(url) && !await decodeImage(url)) complete = false;
        settle();
      }
    };
    await Promise.all([fontWork, ...Array.from({ length: FETCH_POOL }, worker)]);
    artComplete = complete && !controller.signal.aborted;
    await warm.settled;
    unsubscribeWarm();
    return artComplete;
  };
  try { return await Promise.race([work().catch(() => false), expired]); }
  finally { clearTimeout(timeout!); subscribers.clear(); }
}

/** Test hook: forget the in-flight run and its subscribers. */
export function __resetPreload(): void {
  inflight = null;
  subscribers.clear();
  lastDone = 0;
  lastTotal = 0;
}

/**
 * Whether the browser's HTTP cache actually holds this build's assets; the flag alone cannot say,
 * since a hard reload (Ctrl+F5) and cache eviction both empty the cache while localStorage keeps it.
 * The probe reads the masthead the boot loader itself displays (per deploy target): it enumerates
 * nothing extra, and on a cold answer the splash is about to want this exact file first.
 */
export function probeWarmCache(): Promise<boolean> {
  return cacheHolds(`${import.meta.env.BASE_URL}${activeTarget().bootBanner}`);
}
