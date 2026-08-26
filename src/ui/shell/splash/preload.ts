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
let inflight: Promise<void> | null = null;
let subscribers: Progress[] = [];
let lastDone = 0;
let lastTotal = 0;

/**
 * Fetch everything, reporting `(done, total)` after each settled item. Fonts count as items too.
 * Resolves when every item has settled; never rejects.
 */
export function preloadAssets(onProgress: Progress): Promise<void> {
  subscribers.push(onProgress);
  if (inflight) {
    if (lastTotal > 0) onProgress(lastDone, lastTotal);
    return inflight;
  }
  inflight = (async () => {
    // The enumeration lives in its own chunk (see asset-list.ts) so warm boots never pay for it.
    const { splashAssetUrls } = await import('./asset-list');
    const urls = splashAssetUrls();
    const fonts = typeof document !== 'undefined' && typeof (document.fonts as FontFaceSet | undefined)?.load === 'function' ? FONT_FAMILIES : [];
    lastTotal = urls.length + fonts.length;
    lastDone = 0;
    const settle = (): void => {
      lastDone++;
      for (const sub of subscribers) sub(lastDone, lastTotal);
    };

    const queue = [...urls];
    const worker = async (): Promise<void> => {
      for (;;) {
        const url = queue.shift();
        if (url === undefined) return;
        // force-cache: a warm entry answers without a request; a cold one fetches and fills it.
        await fetch(url, { cache: 'force-cache' }).catch(() => undefined);
        settle();
      }
    };
    await Promise.all(Array.from({ length: FETCH_POOL }, worker));
    // Fonts AFTER the art: the CJK families are megabytes, and loading them beside 140 image
    // fetches saturates a slow link — the art (most of the visible progress) would crawl, and a
    // reload landing mid-preload would cut that much more in flight.
    await Promise.all(fonts.map((family) =>
      document.fonts.load(`16px "${family}"`).catch(() => undefined).then(settle)));
  })();
  return inflight;
}

/** Test hook: forget the in-flight run and its subscribers. */
export function resetPreloadForTest(): void {
  inflight = null;
  subscribers = [];
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
    await fetch(url, { cache: 'force-cache' });
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
