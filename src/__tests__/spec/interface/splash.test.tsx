// @vitest-environment jsdom
/** The loading screen of a visit that has to download the editor's files: what its bar measures and
 *  what it waits for, driven through the preload the screen runs, with the network stubbed. */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { Splash } from '../../../ui/shell/splash/Splash';
import { MOTIONS } from '../../../ui/design/motion/registry';
import { spec } from '../../_support/spec';
import { preloadAssets, registerFontsIfWarm, cacheWarmAtBoot, __resetPreload } from '../../../ui/shell/splash/preload';
import { markSplashDone } from '../../../io/storage/splash-facts';
import { splashAssetUrls } from '../../../ui/shell/splash/asset-list';
import { ASSET_SIZES_FILE } from '../../../platform/build/asset-sizes';
import { FONT_FILES, __resetFontFaces } from '../../../assets/fonts/faces';
import { INTERFACE_FACE } from '../../../assets/fonts/family';

/** An image that decodes as soon as it has a source. */
class InstantImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) { queueMicrotask(() => this.onload?.()); }
  decode(): Promise<void> { return Promise.resolve(); }
}

/** The manifest's key for a page URL under the base `/`. */
const key = (url: string): string => new URL(url, location.href).pathname.slice(1);

/** A network that answers the size manifest with `sizes` and every other file at once, except the
 *  `held` files, which answer only when released. Each request is also appended to `log`. */
function network(sizes: Record<string, number>, held: readonly string[] = [], log: string[] = []) {
  const waiting = new Map<string, () => void>();
  const requested: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith(ASSET_SIZES_FILE)) return new Response(JSON.stringify(sizes));
    requested.push(url);
    log.push(`fetch ${url}`);
    if (held.includes(url)) await new Promise<void>((resolve) => { waiting.set(url, resolve); });
    return new Response('x');
  }));
  return { requested, release: (url: string) => waiting.get(url)?.() };
}

/** A browser font registry: records each registered face and each load, in order, into `log` (a
 *  registered face's file is what the page's text requests). A load of a face outside the interface
 *  family never finishes. */
function fontRegistry(log: string[]) {
  const original = Object.getOwnPropertyDescriptor(document, 'fonts');
  vi.stubGlobal('FontFace', class {
    constructor(readonly family: string, _source: string, readonly descriptors: { weight: string }) { log.push(`register ${descriptors.weight} ${family}`); }
    async load(): Promise<this> {
      log.push(`load ${this.descriptors.weight} ${this.family}`);
      if (this.family !== INTERFACE_FACE) await new Promise(() => {});
      return this;
    }
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: () => {} } });
  return () => {
    if (original) Object.defineProperty(document, 'fonts', original);
    else delete (document as unknown as { fonts?: unknown }).fonts;
  };
}

beforeEach(() => {
  __resetPreload();
  __resetFontFaces();
  localStorage.clear();
  vi.stubGlobal('Image', InstantImage);
  // Save-data keeps the warm schedule out, so only the art and fonts count here.
  Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (navigator as { connection?: unknown }).connection;
});

describe('the loading screen', () => {
  spec('UI-37', 'moves its bar by bytes, so one large file outweighs many small ones', async () => {
    const urls = splashAssetUrls();
    const [large, ...small] = urls;
    const sizes = Object.fromEntries([[key(large!), 10_000_000], ...small.map((url) => [key(url), 1_000])]);
    const net = network(sizes, [large!]);
    const seen: [number, number][] = [];
    const run = preloadAssets((done, total) => { seen.push([done, total]); });
    await vi.waitFor(() => expect(seen.at(-1)?.[0]).toBe(small.length * 1_000));
    const [done, total] = seen.at(-1)!;
    // Every small file has arrived; the large one, nearly all of the bytes, has not.
    expect(done / total).toBeCloseTo((small.length * 1_000) / (small.length * 1_000 + 10_000_000), 6);
    expect(done / total).toBeLessThan(0.1);
    net.release(large!);
    expect(await run).toBe(true);
    expect(seen.at(-1)![0] / seen.at(-1)![1]).toBe(1);
  });

  spec('UI-37', 'fetches the interface art before any font, and loads only the first screen\'s fonts before the editor appears', async () => {
    const log: string[] = [];
    const restore = fontRegistry(log);
    try {
      const urls = splashAssetUrls();
      const last = urls.at(-1)!;
      const net = network({}, [last]);
      const run = preloadAssets(() => {});
      await vi.waitFor(() => expect(net.requested).toHaveLength(urls.length));
      await new Promise((r) => setTimeout(r, 20));
      expect(log, 'no font before the last art file has arrived').toEqual([]);
      net.release(last);
      expect(await run).toBe(true);
      const query = ({ family, weight }: { family: string; weight: number }) => `load ${weight} ${family}`;
      const firstScreen = FONT_FILES.filter(({ family }) => family === INTERFACE_FACE);
      const later = FONT_FILES.filter(({ family }) => family !== INTERFACE_FACE);
      // Every face registers once the art is in; the first screen's load before the rest, which the
      // editor does not wait for.
      expect(log.filter((entry) => entry.startsWith('register'))).toHaveLength(FONT_FILES.length);
      const loads = log.filter((entry) => entry.startsWith('load'));
      expect(loads.slice(0, firstScreen.length).sort()).toEqual(firstScreen.map(query).sort());
      expect(loads.slice(firstScreen.length).sort()).toEqual(later.map(query).sort());
    } finally {
      restore();
    }
  });

  spec('UI-37', 'fetches the interface art before any font when the saved flag says ready but the files are gone', async () => {
    // A hard reload or an evicted cache: this build's flag is saved; the boot loader's masthead arrives
    // as a full download, and the probe's own fetch of it then reads from cache.
    markSplashDone();
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([{ transferSize: 51_963 }, { transferSize: 0 }] as PerformanceResourceTiming[]);
    const log: string[] = [];
    const restore = fontRegistry(log);
    try {
      const urls = splashAssetUrls();
      network({}, [], log);
      await registerFontsIfWarm();
      expect(await cacheWarmAtBoot(), 'the boot reads the cache as cold').toBe(false);
      expect(await preloadAssets(() => {})).toBe(true);
      const art = new Set(urls.map((url) => `fetch ${url}`));
      const fonts = new Set(FONT_FILES.map(({ url }) => `fetch ${url}`));
      const lastArt = log.reduce((last, entry, at) => (art.has(entry) ? at : last), -1);
      const firstFont = log.findIndex((entry) => fonts.has(entry) || entry.startsWith('register') || entry.startsWith('load'));
      expect(lastArt).toBeGreaterThanOrEqual(0);
      expect(firstFont, 'every art request precedes any font request').toBeGreaterThan(lastArt);
      // Each first-screen file is downloaded once, by the splash, and its face then loads from cache.
      for (const face of FONT_FILES.filter(({ family }) => family === INTERFACE_FACE)) {
        expect(log.filter((entry) => entry === `fetch ${face.url}`)).toHaveLength(1);
      }
    } finally {
      restore();
    }
  });

  spec('UI-37', 'fills the bar before the editor appears when the deadline releases a stalled download', async () => {
    const [, ...rest] = splashAssetUrls();
    network({}, rest);
    vi.useFakeTimers();
    let handedOff = false;
    render(<I18nProvider><Splash onHandoff={() => { handedOff = true; }} onDone={() => {}} /></I18nProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    const shown = (): string => /(\d+)%/.exec(screen.getByTestId('boot-splash').textContent ?? '')![1]!;
    expect(Number(shown())).toBeLessThan(100);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000 + MOTIONS['splash.pill.fill'].duration! * 1000); });
    expect(handedOff, 'still in the beat before the hand-off').toBe(false);
    expect(shown()).toBe('100');
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(handedOff).toBe(true);
  });
});
