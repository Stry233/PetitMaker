// @vitest-environment jsdom
/**
 * The boot splash: shows only while this build's assets are unfetched, drives on real progress,
 * tolerates failures, and hands off cleanly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { writePref } from '../../../../platform/storage/prefs';
import { preloadAssets, probeWarmCache, __resetPreload } from '../../../../ui/shell/splash/preload';
import { markSplashDone, shouldShowSplash } from '../../../../io/storage/splash-facts';
import { splashAssetUrls } from '../../../../ui/shell/splash/asset-list';
import { MOTIONS } from '../../../../ui/design/motion/registry';
import { I18nProvider, translate } from '../../../../i18n/context';
import { decodeImage } from '../../../../platform/async/http-cache';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fontCss = readFileSync(resolve(__dirname, '../../../../assets/fonts/fonts.css'), 'utf8') as string;

vi.mock('../../../../platform/async/http-cache', async (actual) => ({ ...await actual<object>(), decodeImage: vi.fn(async () => true) }));
const imageFormat = vi.hoisted(() => ({ supportsLosslessWebp: false }));
vi.mock('../../../../assets/image-format', () => imageFormat);

/** A warm schedule run the test drives: `items` counted items, each settled by `settleOne`. */
const warm = vi.hoisted(() => {
  const state = { items: 0, done: 0, listeners: new Set<() => void>(), finish: () => {} };
  const run = () => ({
    total: () => state.items,
    done: () => state.done,
    planned: Promise.resolve(),
    settled: state.items === 0 ? Promise.resolve() : new Promise<void>((resolve) => { state.finish = resolve; }),
    subscribe: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
  });
  const settleOne = () => {
    state.done++;
    for (const listener of state.listeners) listener();
    if (state.done === state.items) state.finish();
  };
  return { state, run, settleOne };
});
vi.mock('../../../../ui/shell/warm/schedule', () => ({ startWarm: warm.run }));

beforeEach(() => {
  localStorage.clear(); __resetPreload();
  warm.state.items = 0; warm.state.done = 0; warm.state.listeners.clear();
  imageFormat.supportsLosslessWebp = false;
  vi.mocked(decodeImage).mockReset().mockResolvedValue(true);
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
    vi.mocked(decodeImage).mockReturnValue(new Promise(resolve => { release = resolve; }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response()));
    let complete = false;
    const work = preloadAssets(vi.fn()).then(result => { complete = true; return result; });
    await vi.waitFor(() => expect(decodeImage).toHaveBeenCalled());
    expect(complete).toBe(false);
    release(true);
    expect(await work).toBe(true);
  });

  it('leaves an unsuccessful image warmup eligible for the next visit', async () => {
    vi.mocked(decodeImage).mockResolvedValue(false);
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
    vi.mocked(decodeImage).mockReturnValue(new Promise(() => {}));
    const work = preloadAssets(vi.fn());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await work).toBe(false);
    expect(shouldShowSplash()).toBe(true);
  });

  it('counts the warm schedule\'s items and waits for them before it completes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response()));
    warm.state.items = 2;
    const totals = new Set<number>();
    let complete = false;
    const work = preloadAssets((_done, total) => { totals.add(total); }).then((result) => { complete = true; return result; });
    await vi.waitFor(() => expect(totals.size).toBeGreaterThan(0));
    const art = splashAssetUrls().length;
    expect([...totals]).toEqual([expect.any(Number)]);
    expect([...totals][0]! - art).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 20));
    expect(complete).toBe(false);
    warm.settleOne(); warm.settleOne();
    expect(await work).toBe(true);
  });

  it('releases the splash at the deadline with the art\'s answer while the warm schedule runs on', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response()));
    warm.state.items = 1;
    const work = preloadAssets(vi.fn());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await work).toBe(true);
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
    markSplashDone();
    expect(shouldShowSplash()).toBe(false);
  });
});

describe('the component', () => {
  it('shows the pill, finishes on real completion, and fires the two hand-off callbacks in order', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response())));
    const { Splash } = await import('../../../../ui/shell/splash/Splash');
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
  /** The splash drawn in a window `height` px tall: its column's zoom and the banner's opening offset. */
  async function columnAt(height: number): Promise<{ zoom: number; travel: number }> {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    vi.stubGlobal('innerHeight', height);
    const { Splash } = await import('../../../../ui/shell/splash/Splash');
    const { unmount } = render(<I18nProvider><Splash onHandoff={() => {}} onDone={() => {}} /></I18nProvider>);
    const banner = screen.getByRole('img', { name: translate('app.name') });
    const zoom = parseFloat(banner.parentElement!.style.zoom);
    const travel = parseFloat(/translateY\((-?[\d.]+)px\)/.exec(banner.style.transform)?.[1] ?? 'NaN');
    unmount();
    return { zoom, travel };
  }

  it('stands at full size where the window has room and zooms down below it', async () => {
    expect((await columnAt(768)).zoom).toBe(1);
    expect((await columnAt(420)).zoom).toBe(1);
    expect((await columnAt(300)).zoom).toBeCloseTo(300 / 420, 6);
  });

  it('opens the banner where the boot loader drew it, whatever the column zoom', async () => {
    expect((await columnAt(768)).travel).toBe(121);
    // The boot loader's banner top is 50vh - 63; the zoomed column's is 50vh - 184 x fit.
    const fit = 210 / 420;
    expect((await columnAt(210)).travel).toBeCloseTo((184 * fit - 63) / fit, 4);
  });
});
