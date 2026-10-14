/*
 * The browser HTTP cache as the page warms it: fetching a file into the cache without keeping it,
 * prefetching one without handing its bytes to the page, decoding an image with one repair of a
 * truncated entry, and probing whether the cache still holds a file. Nothing here decides what to
 * warm or when; ui's warm list does.
 */
import { loadImage } from './load-image';

/**
 * Fetch one file into the browser's HTTP cache without keeping it: the body is read to its end
 * (headers alone do not mean the body is cached) and dropped chunk by chunk. Resolves whether the
 * file arrived; never rejects.
 */
export async function fetchIntoCache(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: 'force-cache', signal });
    if (response.body) {
      const reader = response.body.getReader();
      try { while (!(await reader.read()).done) { /* drain without retaining the bytes */ } }
      finally { reader.releaseLock(); }
    } else { await response.blob(); }
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch one file into the HTTP cache through `<link rel="prefetch">` where the browser supports it:
 * the browser downloads and stores the file without handing its bytes to the page, so a large file
 * leaves no trace in the page's memory. Elsewhere it falls back to `fetchIntoCache`. Resolves whether
 * the file arrived; never rejects.
 */
export function prefetchIntoCache(url: string): Promise<boolean> {
  if (typeof document === 'undefined') return fetchIntoCache(url);
  const link = document.createElement('link');
  if (!link.relList?.supports?.('prefetch')) return fetchIntoCache(url);
  return new Promise((resolve) => {
    const settle = (ok: boolean) => { link.remove(); resolve(ok); };
    link.rel = 'prefetch';
    link.href = url;
    link.onload = () => settle(true);
    link.onerror = () => settle(false);
    document.head.appendChild(link);
  });
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
 * Whether the browser's HTTP cache actually holds `url`: one fetch, then its resource-timing entry.
 * `transferSize` 0 is a pure cache hit, a few hundred bytes is a revalidation answered from cache,
 * and a full body means the cache is cold. No entry (a browser not recording timings) and any
 * failure read as warm, so the probe only ever catches a cold cache.
 */
export async function cacheHolds(url: string): Promise<boolean> {
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
