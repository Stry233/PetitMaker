// @vitest-environment jsdom
/**
 * The boot splash: shows only while this build's assets are unfetched, drives on real progress,
 * tolerates failures, and hands off cleanly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
import { useState } from 'react';
import { writePref } from '../../../../platform/storage/prefs';
import { preloadAssets, probeWarmCache, __resetPreload } from '../../../../ui/shell/splash/preload';
import { markSplashDone, shouldShowSplash } from '../../../../io/storage/splash-facts';
import { splashAssetUrls } from '../../../../ui/shell/splash/asset-list';
import { seconds } from '../../../../ui/design/motion';
import { I18nProvider } from '../../../../i18n/context';
import { decodeImage } from '../../../../platform/async/http-cache';
import { FONT_FILES, __resetFontFaces } from '../../../../assets/fonts/faces';
import { INTERFACE_FACE } from '../../../../assets/fonts/family';

vi.mock('../../../../platform/async/http-cache', async (actual) => ({ ...await actual<object>(), decodeImage: vi.fn(async () => true) }));
const imageFormat = vi.hoisted(() => ({ supportsLosslessWebp: false }));
vi.mock('../../../../assets/image-format', () => imageFormat);

/** A warm schedule run the test drives: `items` counted items, each settled by `settleOne`. */
const warm = vi.hoisted(() => {
  const state = { items: 0, done: 0, listeners: new Set<(item: object) => void>(), finish: () => {} };
  const run = () => ({
    items: () => Array.from({ length: state.items }, () => ({})),
    settledItems: () => Array.from({ length: state.done }, () => ({})),
    planned: Promise.resolve(),
    settled: state.items === 0 ? Promise.resolve() : new Promise<void>((resolve) => { state.finish = resolve; }),
    subscribe: (listener: (item: object) => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
    rush: () => () => {},
  });
  const settleOne = () => {
    state.done++;
    for (const listener of state.listeners) listener({});
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

  it('waits for response bodies and releases an unmounted subscriber', async () => {
    let release!: () => void;
    const body = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: () => body.then(() => new Blob()) })));
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
    // One task turn lets every settled fetch and decode report; only the warm items are left.
    await new Promise((r) => setTimeout(r, 0));
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

  it('keeps a font download running past the deadline and registers its face once the file is whole', async () => {
    const [face] = FONT_FILES.filter(({ family }) => family === INTERFACE_FACE);
    const registered: string[] = [];
    vi.stubGlobal('FontFace', class {
      constructor(_family: string, source: string) { registered.push(source); }
      load(): Promise<this> { return Promise.resolve(this); }
    });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: () => {} } });
    try {
      vi.useFakeTimers();
      let release!: () => void;
      const signals: (AbortSignal | undefined)[] = [];
      vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        if (url !== face!.url) return Promise.resolve(new Response());
        signals.push(init?.signal ?? undefined);
        return new Promise((resolve) => { release = () => resolve(new Response('font')); });
      }));
      const work = preloadAssets(vi.fn());
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await work).toBe(false);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted ?? false, 'the download is not cancelled').toBe(false);
      const isFace = (source: string): boolean => source.includes(face!.url);
      expect(registered.some(isFace), 'not registered over a partial file').toBe(false);
      expect(registered.length).toBe(FONT_FILES.length - 1);
      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(registered.filter(isFace)).toHaveLength(1);
    } finally {
      __resetFontFaces();
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
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
  // Framer's frame loop waits on the animation frame it last asked for; letting the fake clock run
  // past it after unmounting keeps that request from being lost when the real timers return.
  afterEach(async () => {
    cleanup();
    if (vi.isFakeTimers()) await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  });

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
    // The floor and the beat run on timers once the (instant, mocked) fetches settle; the slide on frames.
    for (let i = 0; i < 500 && events.length < 2; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(events).toEqual(['handoff', 'done']);
    expect(shouldShowSplash(), 'a completed pass records the build').toBe(false);
  });

  it('the hand-off waits out the declared motion, so the overlay cannot vanish mid-slide', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response())));
    const { Splash } = await import('../../../../ui/shell/splash/Splash');
    const slideMs = seconds('splash.handoff') * 1000;
    let handedOff = false;
    /** The editor's own use: the splash stands until it reports done. */
    function Host() {
      const [shown, setShown] = useState(true);
      return shown ? <Splash onHandoff={() => { handedOff = true; }} onDone={() => setShown(false)} /> : null;
    }
    vi.useFakeTimers();
    render(<I18nProvider><Host /></I18nProvider>);
    for (let i = 0; i < 1000 && !handedOff; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(handedOff).toBe(true);
    // The hand-off landed within the last 10 ms step, so this stops short of the slide's end.
    await act(async () => { await vi.advanceTimersByTimeAsync(slideMs - 20); });
    expect(screen.queryByTestId('boot-splash'), 'still sliding away').not.toBeNull();
    // The slide ends on an animation frame, so the overlay goes within a few frames of its duration.
    for (let i = 0; i < 10 && screen.queryByTestId('boot-splash'); i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.queryByTestId('boot-splash'), 'gone once the slide has played').toBeNull();
  });
});
