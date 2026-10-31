// @vitest-environment jsdom
/** The web entry's font registration: a visit whose files are cached sets its first frame in the
 *  shipped faces; a visit that has to download them leaves them to the splash. */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { mountApp } from '../../../ui/app/boot';
import { registerFontsIfWarm, __resetPreload } from '../../../ui/shell/splash/preload';
import { markSplashDone } from '../../../io/storage/splash-facts';
import { FONT_FILES, __resetFontFaces } from '../../../assets/fonts/faces';

let registered = 0;

beforeEach(() => {
  __resetPreload();
  __resetFontFaces();
  localStorage.clear();
  registered = 0;
  vi.stubGlobal('FontFace', class { load(): Promise<this> { return Promise.resolve(this); } });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: () => { registered++; } } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('x')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (document as unknown as { fonts?: unknown }).fonts;
  document.body.innerHTML = '';
});

/** Mounts the web entry's way and returns how many faces were registered when the first frame rendered. */
async function firstFrameFaces(): Promise<number> {
  const frames: number[] = [];
  function FirstFrame() {
    frames.push(registered);
    return null;
  }
  mountApp(document.body.appendChild(document.createElement('div')), <FirstFrame />, registerFontsIfWarm());
  await waitFor(() => expect(frames.length).toBeGreaterThan(0));
  return frames[0]!;
}

describe('the boot fonts', () => {
  it('registers every face before the first render of a visit whose files are cached', async () => {
    markSplashDone();
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([{ transferSize: 0 } as PerformanceResourceTiming]);
    // The cache probe answers after the locale has loaded.
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { setTimeout(() => resolve(new Response('x')), 100); })));
    expect(await firstFrameFaces()).toBe(FONT_FILES.length);
  });

  it('registers none at boot when the saved flag says ready but the cache is cold', async () => {
    markSplashDone();
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([{ transferSize: 51_963 }, { transferSize: 0 }] as PerformanceResourceTiming[]);
    expect(await firstFrameFaces()).toBe(0);
  });

  it('registers none at boot on a first visit', async () => {
    expect(await firstFrameFaces()).toBe(0);
  });
});
