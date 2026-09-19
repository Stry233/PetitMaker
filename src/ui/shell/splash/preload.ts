/** Cold visits warm interface art and font faces before the splash hands off to the editor. */
import { readPref, writePref } from '../../../core/runtime/prefs';
import { activeTarget } from '../../../legal/deploy-targets';
import { APP_VERSION, BUILD_SHA } from '../../../version';
import { allIconUrls } from '../../../assets/icon-urls';
import { supportsLosslessWebp } from '../../../assets/image-format';
import { decodeIcon } from './idle-warm';

/** Match the faces in fonts.css, including weights not visible in the initial frame. */
const FONT_FACES = [
  ...[400, 500, 700, 900].map(weight => `${weight} 16px "Alibaba PuHuiTi 3"`),
  ...[500, 700].map(weight => `${weight} 16px "PW Rounded Sans"`),
];

const FETCH_POOL = 8;

type Progress = (done: number, total: number) => void;

/** ONE preload per page, multiplexed: React's dev StrictMode mounts the splash twice, and the
 *  remount must attach to the run already in flight (getting the current count at once) rather
 *  than starting a second sweep or, worse, being the run nobody finishes. */
let inflight: Promise<boolean> | null = null;
const subscribers = new Set<Progress>();
let lastDone = 0;
let lastTotal = 0;

/**
 * Fetch everything, reporting `(done, total)` after each settled item. Fonts count as items too.
 * Resolves whether all items completed successfully within the warmup deadline; never rejects.
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
  const expired = new Promise<false>(resolve => {
    timeout = setTimeout(() => { controller.abort(); resolve(false); }, 30_000);
  });
  const work = async (): Promise<boolean> => {
    const { splashAssetUrls } = await import('./asset-list');
    if (controller.signal.aborted) return false;
    const urls = splashAssetUrls();
    const icons = new Set(allIconUrls());
    const fonts = typeof document !== 'undefined' && typeof (document.fonts as FontFaceSet | undefined)?.load === 'function' ? FONT_FACES : [];
    lastTotal = urls.length + fonts.length;
    lastDone = 0;
    let complete = true;
    const settle = (): void => {
      if (controller.signal.aborted) return;
      lastDone++;
      for (const sub of subscribers) sub(lastDone, lastTotal);
    };
    const fontWork = Promise.all(fonts.map(async face => {
      try { await document.fonts.load(face); } catch { complete = false; }
      settle();
    }));
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (!controller.signal.aborted && cursor < urls.length) {
        const url = urls[cursor++]!;
        try {
          const response = await fetch(url, { cache: 'force-cache', signal: controller.signal });
          if (!response.ok) complete = false;
          // Headers alone do not mean the body has reached the browser cache.
          if (response.body) {
            const reader = response.body.getReader();
            try { while (!(await reader.read()).done) { /* drain without retaining asset bytes */ } }
            finally { reader.releaseLock(); }
          } else { await response.blob(); }
          if (response.ok && !controller.signal.aborted && icons.has(url)) {
            if (!await decodeIcon(url)) complete = false;
          }
        } catch { complete = false; }
        settle();
      }
    };
    await Promise.all([fontWork, ...Array.from({ length: FETCH_POOL }, worker)]);
    return complete && !controller.signal.aborted;
  };
  try { return await Promise.race([work().catch(() => false), expired]); }
  finally { clearTimeout(timeout!); subscribers.clear(); }
}

/** Test hook: forget the in-flight run and its subscribers. */
export function resetPreloadForTest(): void {
  inflight = null;
  subscribers.clear();
  lastDone = 0;
  lastTotal = 0;
}

/**
 * Whether the browser's HTTP cache actually holds this build's assets — the flag alone cannot
 * say: a hard reload (Ctrl+F5) and cache eviction both empty the cache while localStorage keeps
 * the flag. One small asset is fetched and its resource-timing entry read: `transferSize` 0 is a
 * pure cache hit, a few hundred bytes is a revalidation answered from cache, and a full body
 * means the cache is cold. No entry (a browser not recording timings) reads as warm — the probe
 * exists to catch a cold cache, never to nag.
 */
export async function probeWarmCache(): Promise<boolean> {
  // The masthead the boot loader itself displays (per deploy target): probing it enumerates
  // nothing extra, and on a cold answer the splash is about to want this exact file first.
  const url = `${import.meta.env.BASE_URL}${activeTarget().bootBanner}`;
  if (!url || url.startsWith('data:') || typeof performance === 'undefined' || !performance.getEntriesByName) return true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try { await (await fetch(url, { cache: 'force-cache', signal: controller.signal })).blob(); }
    finally { clearTimeout(timer); }
    const entries = performance.getEntriesByName(new URL(url, location.href).href) as PerformanceResourceTiming[];
    const entry = entries[entries.length - 1];
    if (!entry || typeof entry.transferSize !== 'number') return true;
    return entry.transferSize < 1024;
  } catch {
    return true;
  }
}

/** A decoder change selects different immutable assets even within the same build. */
export function splashTag(): string {
  return `${APP_VERSION}#${BUILD_SHA}#${supportsLosslessWebp ? 'webp' : 'png'}`;
}

export function shouldShowSplash(): boolean {
  return readPref('splashDone') !== splashTag();
}

export function markSplashDone(): void {
  writePref('splashDone', splashTag());
}
