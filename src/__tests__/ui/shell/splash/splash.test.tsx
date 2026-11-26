// @vitest-environment jsdom
/** The boot splash's own part: it stands for its least time and a beat, then hands off cleanly. */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
import { useState } from 'react';
import { __resetBootAssets } from '../../../../editor/session/boot-assets';
import { shouldShowSplash } from '../../../../io/storage/splash-facts';
import { seconds } from '../../../../ui/design/motion';
import { I18nProvider } from '../../../../i18n/context';

vi.mock('../../../../platform/async/http-cache', async (actual) => ({ ...await actual<object>(), decodeImage: vi.fn(async () => true) }));
vi.mock('../../../../assets/image-format', () => ({ supportsLosslessWebp: false }));
/** A warm schedule with nothing to count. */
vi.mock('../../../../ui/shell/warm/schedule', () => ({
  startWarm: () => ({
    items: () => [], settledItems: () => [], planned: Promise.resolve(), settled: Promise.resolve(),
    subscribe: () => () => {}, rush: () => () => {},
  }),
}));

// The run loads its art list through a dynamic import, which a fake clock does not wait for.
beforeAll(async () => { await import('../../../../editor/session/boot-asset-list'); });
beforeEach(() => { localStorage.clear(); __resetBootAssets(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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
