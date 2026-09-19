/**
 * The boot splash: shows only while this build's assets are unfetched, drives on real progress,
 * tolerates failures, and hands off cleanly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { writePref } from '../../../core/runtime/prefs';
import {
  markSplashDone, preloadAssets, probeWarmCache, shouldShowSplash, splashTag, resetPreloadForTest,
} from '../../../ui/shell/splash/preload';
import { splashAssetUrls } from '../../../ui/shell/splash/asset-list';
import { MOTIONS } from '../../../ui/shell/motion/registry';
import { bannerTravel, splashFit } from '../../../ui/shell/splash/Splash';
import { I18nProvider } from '../../../i18n/context';
import { decodeIcon } from '../../../ui/shell/splash/idle-warm';
// @ts-ignore - node:fs is untyped in this tree
import { readFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped in this tree
import { resolve } from 'node:path';

declare const __dirname: string;
const fontCss = readFileSync(resolve(__dirname, '../../../assets/fonts/fonts.css'), 'utf8') as string;

vi.mock('../../../ui/shell/splash/idle-warm', () => ({ decodeIcon: vi.fn(async () => true) }));
const imageFormat = vi.hoisted(() => ({ supportsLosslessWebp: false }));
vi.mock('../../../assets/image-format', () => imageFormat);

beforeEach(() => {
  localStorage.clear(); resetPreloadForTest();
  imageFormat.supportsLosslessWebp = false;
  vi.mocked(decodeIcon).mockReset().mockResolvedValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('the preload', () => {
  it('enumerates the art the app resolves through its own globs, deduplicated', () => {
    const urls = splashAssetUrls();
    expect(urls.length).toBeGreaterThan(90); // 79 catalog icons + ui icons + shell + cursors + brand
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.some((u: string) => u.includes('banner.svg'))).toBe(true);
    expect(urls.some((u: string) => u.includes('cursors'))).toBe(true);
    expect(urls.some((u: string) => /shelf-object\/thumb-/.test(u))).toBe(false);
    expect(urls.some((u: string) => u.includes('bridge-park-arch'))).toBe(true);
  });

  it('waits for catalog pixels before completing the splash preload', async () => {
    let release!: (ready: boolean) => void;
    vi.mocked(decodeIcon).mockReturnValue(new Promise(resolve => { release = resolve; }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response()));
    let complete = false;
    const work = preloadAssets(vi.fn()).then(result => { complete = true; return result; });
    await vi.waitFor(() => expect(decodeIcon).toHaveBeenCalled());
    expect(complete).toBe(false);
    release(true);
    expect(await work).toBe(true);
  });

  it('leaves an unsuccessful image warmup eligible for the next visit', async () => {
    vi.mocked(decodeIcon).mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response()));
    expect(await preloadAssets(vi.fn())).toBe(false);
    expect(shouldShowSplash()).toBe(true);
  });

  it('starts all declared font weights while image bodies are still loading', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'fonts');
    const load = vi.fn(async (_face: string) => []);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    let release!: () => void;
    const body = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: () => body })));
    try {
      const work = preloadAssets(vi.fn());
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(6));
      const declared = [...fontCss.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, block]) => {
        const family = /font-family:\s*'([^']+)'/.exec(block!)![1];
        const weight = /font-weight:\s*(\d+)/.exec(block!)![1];
        return `${weight} 16px "${family}"`;
      });
      expect(load.mock.calls.map(call => call[0]).sort()).toEqual(declared.sort());
      release();
      expect(await work).toBe(true);
    } finally {
      release();
      if (original) Object.defineProperty(document, 'fonts', original);
      else delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  it('waits for response bodies and releases an unmounted subscriber', async () => {
    let release!: () => void;
    const body = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: () => body })));
    const progress = vi.fn();
    const subscription = new AbortController();
    const run = preloadAssets(progress, subscription.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(progress).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(8);
    subscription.abort();
    release();
    expect(await run).toBe(true);
    expect(progress).not.toHaveBeenCalled();
  });

  it('finishes an incomplete warmup after a stalled request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const run = preloadAssets(vi.fn());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await run).toBe(false);
    expect(shouldShowSplash()).toBe(true);
  });

  it('releases the splash deadline when image decoding stalls', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response()));
    vi.mocked(decodeIcon).mockReturnValue(new Promise(() => {}));
    const work = preloadAssets(vi.fn());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await work).toBe(false);
    expect(shouldShowSplash()).toBe(true);
  });

  it('reports monotone progress and never rejects, failures included', async () => {
    const seen: number[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string) =>
      (url.length % 3 === 0 ? Promise.reject(new Error('offline')) : Promise.resolve(new Response()))));
    await preloadAssets((done, total) => { seen.push(done / total); });
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
  });
});

describe('the cache probe', () => {
  // The flag can lie warm (a hard reload empties the cache, not localStorage): the probe reads
  // one asset's resource timing. transferSize 0 = cache; a full body = cold.
  const stubTiming = (transferSize: number | undefined) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response())));
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue(
      transferSize === undefined ? [] : [{ transferSize } as PerformanceResourceTiming],
    );
  };

  it('reads a zero-transfer answer as warm and a full body as cold', async () => {
    stubTiming(0);
    expect(await probeWarmCache()).toBe(true);
    stubTiming(48213);
    expect(await probeWarmCache()).toBe(false);
  });

  it('a browser recording no timing entry reads as warm — the probe never nags', async () => {
    stubTiming(undefined);
    expect(await probeWarmCache()).toBe(true);
  });
});

describe('the skip', () => {
  it('warms the selected artwork again when decoder support changes between visits', () => {
    markSplashDone();
    imageFormat.supportsLosslessWebp = true;
    expect(shouldShowSplash()).toBe(true);
    markSplashDone();
    expect(shouldShowSplash()).toBe(false);
    imageFormat.supportsLosslessWebp = false;
    expect(shouldShowSplash()).toBe(true);
  });

  it('shows on a build whose assets were never fetched, and not again after one completed pass', () => {
    expect(shouldShowSplash()).toBe(true);
    markSplashDone();
    expect(shouldShowSplash()).toBe(false);
  });

  it('a NEW build shows the splash again — its asset URLs are new', () => {
    writePref('splashDone', 'some-older-build#deadbeef');
    expect(shouldShowSplash()).toBe(true);
    expect(splashTag()).not.toBe('some-older-build#deadbeef');
  });
});

describe('the component', () => {
  it('shows the pill, finishes on real completion, and fires the two hand-off callbacks in order', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response())));
    const { Splash } = await import('../../../ui/shell/splash/Splash');
    const events: string[] = [];
    vi.useFakeTimers();
    render(
      <I18nProvider>
        <Splash onHandoff={() => events.push('handoff')} onDone={() => events.push('done')} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('boot-splash')).toBeTruthy();
    // The floor + beat + hand-off all run on timers once the (instant, mocked) fetches settle.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(events).toEqual(['handoff', 'done']);
    expect(shouldShowSplash(), 'a completed pass records the build').toBe(false);
  });

  it('the hand-off waits out the declared motion, so the overlay cannot vanish mid-slide', () => {
    expect(MOTIONS['splash.handoff'].duration).toBeGreaterThan(0);
  });
});

describe('the column fits the visible window', () => {
  it('stands at full size where the window has room and zooms down below it', () => {
    expect(splashFit(768)).toBe(1);
    expect(splashFit(420)).toBe(1);
    expect(splashFit(300)).toBeCloseTo(300 / 420, 6);
  });

  it('opens the banner where the boot loader drew it, whatever the column zoom', () => {
    expect(bannerTravel(1)).toBe(121);
    expect(bannerTravel(0.5)).toBeCloseTo((184 * 0.5 - 63) / 0.5, 6);
  });
});
