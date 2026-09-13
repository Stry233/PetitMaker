/*
 * preload.ts — the boot splash's work: fetch every art asset the interface will need, so the
 * editor never downloads a sprite or a cursor mid-gesture.
 *
 * The list is enumerated from the same Vite globs the app resolves assets through (icon-urls for
 * the icon set; the shell art and cursor globs here mirror how frame.ts and cursor-vars import
 * theirs), so an asset added to those folders joins the preload with no second list to maintain.
 * Fonts ride the FontFace API instead of fetch: `document.fonts.load` pulls exactly the files the
 * declared families resolve to.
 *
 * A fetch that FAILS still counts as done — the splash's contract is "warm what can be warmed",
 * and one missing file must never hold the whole editor hostage. Whether the splash shows at all
 * is `shouldShowSplash`: asset URLs carry the build's content hash, so one completed pass per
 * build means the browser cache answers every later boot, and the splash would be a wait in
 * front of nothing.
 */
import { readPref, writePref } from '../../../core/runtime/prefs';
import { activeTarget } from '../../../legal/deploy-targets';
import { APP_VERSION, BUILD_SHA } from '../../../version';

/** The font families fonts.css declares; loading them resolves and caches their files. */
const FONT_FAMILIES = ['PW Rounded Sans', 'Alibaba PuHuiTi 3'];

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
    const fonts = typeof document !== 'undefined' && typeof (document.fonts as FontFaceSet | undefined)?.load === 'function' ? FONT_FAMILIES : [];
    lastTotal = urls.length + fonts.length;
    lastDone = 0;
    let complete = true;
    const settle = (): void => {
      if (controller.signal.aborted) return;
      lastDone++;
      for (const sub of subscribers) sub(lastDone, lastTotal);
    };
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
        } catch { complete = false; }
        settle();
      }
    };
    await Promise.all(Array.from({ length: FETCH_POOL }, worker));
    if (controller.signal.aborted) return false;
    await Promise.all(fonts.map(async family => {
      try { await document.fonts.load(`16px "${family}"`); } catch { complete = false; }
      settle();
    }));
    return complete;
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

/** The tag a completed preload records: same build → same immutable asset URLs. */
export function splashTag(): string {
  return `${APP_VERSION}#${BUILD_SHA}`;
}

export function shouldShowSplash(): boolean {
  return readPref('splashDone') !== splashTag();
}

export function markSplashDone(): void {
  writePref('splashDone', splashTag());
}
