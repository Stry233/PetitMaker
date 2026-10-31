/*
 * The browser HTTP cache as the page warms it: fetching a file into the cache without keeping it,
 * prefetching one without handing its bytes to the page, decoding an image with one repair of a
 * truncated entry, and probing whether the cache still holds a file. Nothing here decides what to
 * warm or when; ui's warm list does.
 */
import { loadImage } from './load-image';

/**
 * Fetch one file into the browser's HTTP cache without keeping it: the body is read to its end
 * (headers alone do not mean the body is cached) and dropped chunk by chunk, `onBytes` hearing each
 * chunk's decoded length. Resolves whether the file arrived; never rejects.
 */
export async function fetchIntoCache(url: string, signal?: AbortSignal, onBytes?: (bytes: number) => void): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: 'force-cache', signal });
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) onBytes?.(chunk.value.byteLength);
      } finally { reader.releaseLock(); }
    } else { onBytes?.((await response.blob()).size); }
    return response.ok;
  } catch {
    return false;
  }
}

/** How long a page's first prefetch links may stay silent before the page reads prefetch as switched
 *  off: Gecko with `network.prefetch-next` false (uBlock Origin's default) still reports the token as
 *  supported but never requests the file nor fires load or error. */
const PREFETCH_SILENCE_MS = 4000;
/** Whether this page's prefetch links answer: true once any fired load or error, false once one stayed
 *  silent past `PREFETCH_SILENCE_MS`, null until either. */
let prefetchAnswers: boolean | null = null;
/** The links still waiting for the page's first answer, each falling back to a fetch when told. */
const unanswered = new Set<() => void>();

/**
 * Fetch one file into the HTTP cache through `<link rel="prefetch">` where the browser supports it:
 * the browser downloads and stores the file without handing its bytes to the page, so a large file
 * leaves no trace in the page's memory. Elsewhere, and on a page whose prefetch links never answer,
 * it falls back to `fetchIntoCache`. Resolves whether the file arrived; never rejects, and always
 * settles.
 */
export function prefetchIntoCache(url: string): Promise<boolean> {
  if (typeof document === 'undefined' || prefetchAnswers === false) return fetchIntoCache(url);
  const link = document.createElement('link');
  if (!link.relList?.supports?.('prefetch')) return fetchIntoCache(url);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean | Promise<boolean>): void => {
      if (settled) return;
      settled = true;
      unanswered.delete(fallBack);
      link.remove();
      resolve(result);
    };
    const answered = (ok: boolean) => (): void => {
      prefetchAnswers = true;
      unanswered.clear();
      finish(ok);
    };
    const fallBack = (): void => finish(fetchIntoCache(url));
    link.rel = 'prefetch';
    link.href = url;
    link.onload = answered(true);
    link.onerror = answered(false);
    document.head.appendChild(link);
    if (prefetchAnswers === true) return;
    unanswered.add(fallBack);
    setTimeout(() => {
      if (settled || prefetchAnswers === true) return;
      prefetchAnswers = false;
      for (const waiting of [...unanswered]) waiting();
    }, PREFETCH_SILENCE_MS);
  });
}

/** Test hook: forget whether this page's prefetch links answer. */
export function __resetPrefetch(): void {
  prefetchAnswers = null;
  unanswered.clear();
}

const decoded = new Map<string, Promise<boolean>>();

async function loadDecoded(url: string): Promise<void> {
  const img = await loadImage(url);
  // Older browsers finish at load; a missing decode API does not mean a corrupt cache entry.
  if (typeof img.decode === 'function') await img.decode();
}

/** Decodes an image once per page, with at most one cache repair per URL; whether it decoded. */
export function decodeImage(url: string): Promise<boolean> {
  let job = decoded.get(url);
  if (!job) {
    job = (async () => {
      try { await loadDecoded(url); return true; }
      catch {
        // Interrupted downloads can leave truncated HTTP-cache entries.
        try {
          const response = await fetch(url, { cache: 'reload' });
          if (!response.ok) return false;
          await response.blob();
          await loadDecoded(url);
          return true;
        } catch { return false; }
      }
    })();
    decoded.set(url, job);
  }
  return job;
}

/** Test hook: forget every decode. */
export function __resetDecodes(): void {
  decoded.clear();
}

/**
 * Whether the browser's HTTP cache held `url` when this page loaded: one fetch, then every
 * resource-timing entry for it. `transferSize` 0 is a pure cache hit and a few hundred bytes a
 * revalidation answered from cache; any entry carrying a full body means the cache was cold, since
 * a file the page already loaded once answers the probe's own fetch from cache. No entry (a browser
 * not recording timings) and any failure read as warm, so the probe only ever catches a cold cache.
 */
export async function cacheHolds(url: string): Promise<boolean> {
  if (!url || url.startsWith('data:') || typeof performance === 'undefined' || !performance.getEntriesByName) return true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try { await (await fetch(url, { cache: 'force-cache', signal: controller.signal })).blob(); }
    finally { clearTimeout(timer); }
    const entries = performance.getEntriesByName(new URL(url, location.href).href) as PerformanceResourceTiming[];
    return !entries.some((entry) => typeof entry.transferSize === 'number' && entry.transferSize >= 1024);
  } catch {
    return true;
  }
}
