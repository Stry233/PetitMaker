// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchIntoCache, __resetPrefetch } from '../../../platform/async/http-cache';

/** A browser that lists the prefetch token as supported; jsdom itself never loads a prefetch link,
 *  which is what Gecko does with `network.prefetch-next` false. */
beforeEach(() => {
  __resetPrefetch();
  document.head.replaceChildren();
  vi.spyOn(DOMTokenList.prototype, 'supports').mockImplementation((token) => token === 'prefetch');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const prefetchLinks = (): HTMLLinkElement[] => [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="prefetch"]')];

describe('prefetching into the cache', () => {
  it('[UI-37] fetches the files itself when the browser never answers its prefetch links', async () => {
    vi.useFakeTimers();
    const fetched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { fetched.push(url); return new Response('x'); }));
    const first = prefetchIntoCache('/a.webp');
    const second = prefetchIntoCache('/b.webp');
    expect(prefetchLinks()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(fetched).toEqual(['/a.webp', '/b.webp']);
    expect(prefetchLinks()).toEqual([]);
    // The page now knows: a later file is fetched at once.
    expect(await prefetchIntoCache('/c.webp')).toBe(true);
    expect(fetched).toEqual(['/a.webp', '/b.webp', '/c.webp']);
  });

  it('keeps waiting on a slow link once the browser has answered a prefetch', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response('x'));
    vi.stubGlobal('fetch', fetch);
    const slow = prefetchIntoCache('/big.bin');
    const quick = prefetchIntoCache('/small.webp');
    prefetchLinks().find((link) => link.href.endsWith('/small.webp'))!.onload!(new Event('load'));
    expect(await quick).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    let done = false;
    void slow.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    prefetchLinks()[0]!.onload!(new Event('load'));
    expect(await slow).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
