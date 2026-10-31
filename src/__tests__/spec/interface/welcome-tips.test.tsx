// @vitest-environment jsdom
/**
 * The welcome tips through their rendered window and the store's public actions: when they open,
 * what each card says in each input mode, Show me on the live shell, the summary, and the reels.
 */
import { describe, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { translateFor } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import type { InputMode } from '../../../platform/device/input-mode';
import { useEditorStore } from '../../../state/store';
import { readPref, writePref } from '../../../platform/storage/prefs';
import { Shell } from '../../../ui/shell/Shell';
import { Tour } from '../../../ui/chrome/tour/Tour';
import { TOUR_KINDS, tourCards } from '../../../ui/chrome/tour/deck';
import { TOUR_VERSION } from '../../../ui/chrome/tour/version';
import { __resetReelTimings, __setReelFiles, REEL_ASPECT, reelFiles } from '../../../ui/chrome/tour/reels';
import { REEL_FILES } from '../../../ui/chrome/tour/reel-files';
import { LOCALES } from '../../../core/model/locale';
import { startTour, tourWarmFiles, useFirstLaunchTour } from '../../../ui/chrome/tour/use-tour';
import { WhatsNewGate } from '../../../ui/chrome/modals/whats-new/WhatsNewGate';
import { TourPreview } from '../../../ui/help/figures/previews/tour';
import { playedReel, REEL_TYPES } from '../../../ui/chrome/tour/reels';
import type { MapAnnotation } from '../../../core/model/annotations';
import { TerrainType, type MacroCoord } from '../../../core/model/types';
import { paintTerrainCommand } from '../../../core/model/command-build';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { tourTargetSelector, type TourTargetId } from '../../../ui/chrome/tour/steps';
import { enlargedScales, liftedPlateShrink, reelEnlargement, reelRadius, reelTab } from '../../../ui/chrome/tour/TourReel';
import { setStoreModal, setStoreState } from '../../_support/store';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { spec } from '../../_support/spec';
import type { HandoffStage } from '../../../ui/session/splash-handoff';
import { EditorRoot } from '../../../ui/app/EditorRoot';
import { NO_DOCK } from '../../../ui/design/scale';
import type { TourWatch } from '../../../ui/session/tour-watch';
import type { CameraAngle } from '../../../state/view-camera';
import { host } from '../../../editor/host/host';
import { RUN } from '../../../editor/commands/commands';
import { holdEditInFlight } from '../../../state/edits-in-flight';
import { MAP_LIST } from '../../../config/maps';
import { getRoadMaterials } from '../../../state/catalog';
import { autosave } from '../../../editor/session/autosave';
import { installEditorSession } from '../../../editor/session/install';
import { readAutosave } from '../../../io/storage/autosave';

const device = vi.hoisted(() => ({ webgl2: true }));
vi.mock('../../../platform/device/device-quality', async (orig) => ({
  ...(await orig<object>()),
  hasWebGL2: () => device.webgl2,
}));

const en = (key: Parameters<typeof translateFor>[1], params?: Record<string, string | number>) => translateFor('en', key, params as never);

function mountTips(inputMode: InputMode = 'pc', reduced = true) {
  return render(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <I18nProvider><InputModeProvider inputMode={inputMode}><Tour /></InputModeProvider></I18nProvider>
    </MotionConfig>,
  );
}

const deck = () => screen.getByTestId('tour-deck');
/** The outgoing card stays for its fade; these wait until one card stands. */
const settled = () => waitFor(() => expect(within(deck()).getAllByRole('heading')).toHaveLength(1));
const title = () => within(deck()).getByRole('heading').textContent;
const press = async (name: string) => { await settled(); fireEvent.click(within(deck()).getByRole('button', { name })); };
const onCard = async (key: Parameters<typeof translateFor>[1]) => { await settled(); expect(title()).toBe(en(key)); };
/** Back to the tips, pressed in the callout of the Show me step standing, once it shows. */
const backToTips = async () => {
  const callout = await screen.findByTestId('tour-callout', undefined, { timeout: 4000 });
  const back = within(callout).getByRole('button', { name: en('tour.back_to_tips') });
  act(() => fireEvent.click(back));
};

beforeEach(() => {
  localStorage.clear();
  device.webgl2 = true;
  setStoreState({ locale: 'en', tourRunning: false });
  useEditorStore.getState().setEditMode({ mode: null });
  useEditorStore.getState().setViewMode('2d');
});
afterEach(() => {
  cleanup();
  act(() => { useEditorStore.getState().finishTour(); });
  vi.restoreAllMocks();
});

describe('when the welcome tips open', () => {
  spec('UI-50', 'a first visit opens them on the welcome card and records this version as offered', async () => {
    renderHook(() => useFirstLaunchTour(false));
    mountTips();
    expect(useEditorStore.getState().tourRunning).toBe(true);
    await onCard('tour.welcome_title');
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe(String(TOUR_VERSION));
  });

  spec('UI-50', 'a browser offered the older tour sees them once, even holding a saved map', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    renderHook(() => useFirstLaunchTour(true));
    expect(useEditorStore.getState().tourRunning).toBe(true);
    act(() => { useEditorStore.getState().finishTour(); });
    cleanup();
    renderHook(() => useFirstLaunchTour(true));
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  spec('UI-50', 'a browser holding a saved map from before any tips is not shown them, and is recorded', async () => {
    renderHook(() => useFirstLaunchTour(true));
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe(String(TOUR_VERSION));
  });

  spec('UI-50', 'a browser whose storage cannot be read is never shown them', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    renderHook(() => useFirstLaunchTour(false));
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  spec('UI-50', 'Skip and Start building both leave this version offered', async () => {
    startTour();
    mountTips();
    await press(en('tour.skip'));
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe(String(TOUR_VERSION));
    localStorage.removeItem(TOUR_SEEN_KEY);
    act(() => startTour());
    for (let i = 0; i < tourCards(true).length; i++) await press(en('tour.next'));
    act(() => fireEvent.click(screen.getByRole('button', { name: en('tour.start') })));
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe(String(TOUR_VERSION));
  });

  spec('UI-51', 'a visit that opens the newer tips says nothing of What\'s new and leaves it for the next visit', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    writePref('lastSeenVersion', '0.0.1');
    setStoreModal('whatsNew', false);
    render(<WhatsNewGate splashActive={false} />);
    renderHook(() => useFirstLaunchTour(true));
    act(() => { useEditorStore.getState().finishTour(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(useEditorStore.getState().modals.whatsNew).toBe(false);
    expect(readPref('lastSeenVersion')).toBe('0.0.1');
  });
});

describe('one decision a visit', () => {
  spec('UI-51', 'What\'s new hears that this visit opens the newer tips even when it looks after they recorded the offer', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    writePref('lastSeenVersion', '0.0.1');
    setStoreModal('whatsNew', false);
    renderHook(() => useFirstLaunchTour(true));
    render(<WhatsNewGate splashActive={false} />);
    act(() => { useEditorStore.getState().finishTour(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(useEditorStore.getState().modals.whatsNew).toBe(false);
    expect(readPref('lastSeenVersion')).toBe('0.0.1');
  });
});

describe('the cards', () => {
  spec('UI-45', 'Back keeps its place on the first card, Next walks the cards and the dots go to a card', async () => {
    startTour();
    mountTips();
    const back = within(deck()).getByText(en('tour.back')).closest('button')!;
    expect(back.style.visibility).toBe('hidden');
    await press(en('tour.next'));
    await onCard('tour.move_title');
    await press(en('tour.dot', { n: 4, total: tourCards(true).length }));
    await onCard('tour.objects_title');
    await press(en('tour.back'));
    await onCard('tour.shape_title');
  });

  spec('UI-45', 'a wide card holds one Skip, the one a press at its place reaches', async () => {
    setStoreState({ layoutShape: 'landscape' });
    startTour();
    mountTips();
    await settled();
    const skips = [...deck().querySelectorAll('button')].filter((b) => b.textContent?.trim() === en('tour.skip'));
    expect(skips).toHaveLength(1);
    fireEvent.click(skips[0]!);
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  spec('UI-45', 'a card holds one heading, its own title, while the other cards only hold room unseen', async () => {
    startTour();
    mountTips();
    await settled();
    const headings = [...deck().querySelectorAll('h1, h2, h3')];
    expect(headings.map((h) => h.textContent)).toEqual([en('tour.welcome_title')]);
  });

  spec('UI-45', 'Escape and a press outside close the tips, and under them the map takes no shortcut', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    render(<I18nProvider><InputModeProvider inputMode="pc"><Shell onRestoreSession={() => {}}><div data-testid="map-views" /></Shell></InputModeProvider></I18nProvider>);
    act(() => startTour());
    await settled();
    act(() => { fireEvent.keyDown(document.body, { key: '`', code: 'Backquote' }); });
    expect(useEditorStore.getState().viewMode).toBe('2d');
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(useEditorStore.getState().tourRunning).toBe(false);
    act(() => startTour());
    await settled();
    const outside = deck().parentElement!;
    act(() => { fireEvent.pointerDown(outside); fireEvent.mouseDown(outside); fireEvent.pointerUp(outside); fireEvent.click(outside); });
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  spec('UI-24', 'a device without WebGL2 leaves out the 3D card', async () => {
    device.webgl2 = false;
    expect(tourCards(false).map((c) => c.kind)).not.toContain('view3d');
    expect(tourCards(true).map((c) => c.kind)).toContain('view3d');
  });

  spec('UI-46', 'touch mode words the gestures by finger and shows no keys; PC mode words them by mouse and shows its keys', async () => {
    startTour();
    mountTips('touch');
    await press(en('tour.next'));
    expect(deck().textContent).toContain(en('tour.move_body_touch'));
    expect(within(deck()).queryByTestId('tour-keys')).toBeNull();
    cleanup();
    // The run stands where it was: the same card, now worded for the mouse.
    mountTips('pc');
    await onCard('tour.move_title');
    expect(deck().textContent).toContain(en('tour.move_body'));
    expect(within(deck()).getByTestId('tour-keys').textContent).toContain('Ctrl 0');
  });

  /** The opening card's reel frame on a `w` by `h` upright touch window whose sheet holds `others` px
   *  of words, bars and buttons beside the clip. jsdom lays nothing out, so the sheet's height is
   *  stubbed as the frame plus `others`, and the words as never scrolling. */
  const uprightFrame = async (w: number, h: number, others: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
    window.dispatchEvent(new Event('resize'));
    const frameOf = () => screen.getByTestId('tour-reel-clip').parentElement!.parentElement!;
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-tour-screen') ? others + parseFloat(frameOf().style.height) : 0;
    });
    const offset = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return parseFloat(this.style.height) || 0;
    });
    try {
      startTour();
      render(
        <MotionConfig reducedMotion="always">
          <I18nProvider><InputModeProvider inputMode="touch" shape="portrait"><Tour /></InputModeProvider></I18nProvider>
        </MotionConfig>,
      );
      await settled();
      const card = deck();
      const zoom = Number(card.style.zoom) || 1;
      // The stubbed heights reach the layout through a size observer: wait for the frame to settle.
      let last = '';
      await waitFor(() => { const now = frameOf().style.height; const same = now === last; last = now; expect(same).toBe(true); });
      const frame = frameOf();
      return { w: parseFloat(frame.style.width), h: parseFloat(frame.style.height), radius: parseFloat(frame.style.borderRadius), cardW: w / zoom, zoom };
    } finally {
      scroll.mockRestore();
      offset.mockRestore();
      cleanup();
      act(() => { useEditorStore.getState().finishTour(); });
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    }
  };

  spec('UI-46', 'upright, the words and buttons keep their room and the reel takes the height left at its own proportions', async () => {
    for (const [w, h] of [[390, 844], [412, 915], [360, 640]] as const) {
      const others = 300;
      const f = await uprightFrame(w, h, others);
      const sheetPadding = 38;
      expect((f.h + others + sheetPadding) * f.zoom, `${w}x${h}: the sheet fits the window`).toBeLessThan(h);
      expect(f.w, `${w}x${h}: within the sheet's width`).toBeLessThanOrEqual(f.cardW);
      expect(f.w / f.h, `${w}x${h}: its own proportions`).toBeCloseTo(REEL_ASPECT['touch-tall'], 3);
    }
  });

  spec('UI-46', 'a reel\'s frame rounds its corners by the same share of its size at every size', async () => {
    const small = await uprightFrame(360, 640, 200);
    const large = await uprightFrame(430, 932, 200);
    expect(large.w).toBeGreaterThan(small.w);
    expect(small.radius / small.w).toBeCloseTo(large.radius / large.w, 3);
  });
});

describe('the summary', () => {
  spec('UI-48', 'shows a tile per card it covers, each returning to its card', async () => {
    startTour();
    mountTips();
    const cards = tourCards(true);
    for (let i = 0; i < cards.length; i++) await press(en('tour.next'));
    expect(screen.getByTestId('tour-recap').textContent).toContain(en('tour.recap_body'));
    const tiles = cards.filter((c) => c.tileKey);
    expect(tiles.map((c) => c.kind)).not.toContain('welcome');
    for (const card of tiles) expect(screen.getByRole('button', { name: en('tour.recap_tile', { tip: en(card.tileKey!) }) })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en('tour.recap_tile', { tip: en('tour.shape_tile') }) }));
    await onCard('tour.shape_title');
  });
});

describe('how the tips move', () => {
  const backdrop = () => deck().parentElement!;

  spec('UI-53', 'opened under the loading screen, the window stands lowered with the editor and rises with it as the screen lifts', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    const view = (stage: HandoffStage) => <EditorRoot dockRef={NO_DOCK} onRestoreSession={() => {}} plane={{ handoff: stage }}><div data-testid="map-views" /></EditorRoot>;
    const { rerender } = render(view('covered'));
    act(() => startTour());
    /** The editor's plane: the box the shift moves, holding the map views. */
    const plane = () => {
      let el: HTMLElement | null = screen.getByTestId('map-views');
      while (el && !el.style.transform) el = el.parentElement;
      return el;
    };
    /** The window wears the plane's shift exactly while the plane wears one, and none once it wears none. */
    const same = (shifted: boolean): string => {
      const shift = plane();
      expect(!!shift, shifted ? 'the plane shifted' : 'the plane at rest').toBe(shifted);
      expect(backdrop().style.transform).toBe(shift?.style.transform ?? '');
      expect(backdrop().style.transition).toBe(shift?.style.transition ?? '');
      return backdrop().style.transform;
    };
    const lowered = same(true);
    rerender(view('leaving'));
    expect(same(true), 'rising from where it stood lowered').not.toBe(lowered);
    rerender(view('none'));
    same(false);
  });

  spec('UI-53', 'opened later, the window wears no hand-off at all', () => {
    startTour();
    mountTips();
    expect(backdrop().style.transform).toBe('');
  });

  /** The offset an arriving card's words start from: positive from the end side, negative from the start. */
  const arrivingFrom = (key: Parameters<typeof translateFor>[1]): number => {
    const heading = within(deck()).getByRole('heading', { name: en(key) });
    let el: HTMLElement | null = heading;
    while (el && !el.style.transform) el = el.parentElement;
    return Number(/translateX\((-?[\d.]+)px\)/.exec(el?.style.transform ?? '')?.[1] ?? 0);
  };

  spec('UI-53', 'the words travel in from the way the reader went, and the controls and dots stay the same', async () => {
    startTour();
    mountTips('pc', false);
    const next = within(deck()).getByRole('button', { name: en('tour.next') });
    const dot = within(deck()).getByRole('button', { name: en('tour.dot', { n: 1, total: tourCards(true).length }) });
    // Once the card it replaces has gone, so the next move starts from rest.
    const crossed = () => waitFor(() => expect(deck().querySelector('[data-leaving]')).toBeNull());
    fireEvent.click(next);
    expect(arrivingFrom('tour.move_title')).toBeGreaterThan(0);
    await crossed();
    fireEvent.click(within(deck()).getByRole('button', { name: en('tour.back') }));
    expect(arrivingFrom('tour.welcome_title')).toBeLessThan(0);
    await crossed();
    expect(within(deck()).getByRole('button', { name: en('tour.next') })).toBe(next);
    expect(within(deck()).getByRole('button', { name: en('tour.dot', { n: 1, total: tourCards(true).length }) })).toBe(dot);
  });

  spec('UI-53', 'every card\'s words hold the words\' place unseen, so a turn never changes the room above the dots and buttons', async () => {
    startTour();
    mountTips('pc');
    const room = () => deck().querySelector<HTMLElement>('[data-tour-words-room]')!;
    const cards = tourCards(true);
    expect(room().children).toHaveLength(cards.length);
    for (const card of cards) expect(room().textContent).toContain(en(card.titleKey));
    expect(room().getAttribute('aria-hidden')).toBe('true');
    expect(room().hasAttribute('inert')).toBe(true);
    const held = room().innerHTML;
    await press(en('tour.next'));
    await settled();
    expect(room().innerHTML, 'the same room on the next card').toBe(held);
    expect(screen.getAllByTestId('tour-show-me').length, 'the unseen words offer no second control').toBeLessThanOrEqual(1);
  });

  spec('UI-53', 'the dot of the card shown widens into a line as the one left shrinks back into a dot', async () => {
    startTour();
    mountTips();
    const slot = (n: number) => within(deck()).getByRole('button', { name: en('tour.dot', { n, total: tourCards(true).length }) });
    const drawn = (n: number) => parseFloat(slot(n).querySelector<HTMLElement>('[data-tour-dot]')!.style.width);
    expect(drawn(1)).toBeGreaterThan(drawn(4));
    const dot = drawn(4);
    await press(en('tour.dot', { n: 4, total: tourCards(true).length }));
    expect(slot(4).getAttribute('aria-current')).toBe('step');
    await waitFor(() => expect(drawn(4)).toBeGreaterThan(dot));
    expect(drawn(1)).toBe(dot);
  });

  spec('UI-53', 'a reel\'s caption keeps the room of its longest caption, so a change of caption moves nothing', async () => {
    const segs = [['pick', 0], ['size', 3], ['spray', 6]];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ welcome: { end: 9, segs } }))));
    __resetReelTimings();
    try {
      startTour();
      mountTips('pc', false);
      const video = screen.getByTestId('tour-reel-clip-video') as HTMLVideoElement;
      let time = 1;
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: (v: number) => { time = v; } });
      fireEvent(video, new Event('playing'));
      await within(deck()).findByRole('group', { name: en('tour.reel_parts') });
      const caption = () => screen.getByTestId('tour-reel').lastElementChild as HTMLElement;
      const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
      const unseen = () => [...caption().querySelectorAll<HTMLElement>('*')].filter((el) => el.style.visibility === 'hidden').map((el) => el.textContent);
      await waitFor(() => expect(caption().textContent).toContain(en('tour.reel.welcome.pick')));
      const every = ['pick', 'size', 'spray'].map((id) => en(`tour.reel.welcome.${id}` as Parameters<typeof en>[0]));
      expect(unseen(), 'every caption holds its room under the one shown').toEqual(every);
      time = 7;
      await frame();
      await frame();
      expect(unseen()).toEqual(every);
    } finally {
      vi.unstubAllGlobals();
      __resetReelTimings();
    }
  });

  spec('UI-53', 'a reel starting over empties every bar at once, and only a pressed part glides', async () => {
    const files = reelFiles('en', 'mouse-land', 'welcome')!;
    const segs = [['pick', 0], ['size', 3], ['spray', 6]];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ welcome: { end: 9, segs } }))));
    __resetReelTimings();
    try {
      startTour();
      mountTips('pc', false);
      const video = screen.getByTestId('tour-reel-clip-video') as HTMLVideoElement;
      let time = 9;
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: (v: number) => { time = v; } });
      video.play = () => Promise.resolve();
      fireEvent(video, new Event('playing'));
      expect(files.timing).toBeTruthy();
      const parts = await within(deck()).findByRole('group', { name: en('tour.reel_parts') });
      const bars = within(parts).getAllByRole('button');
      expect(bars).toHaveLength(segs.length);
      const fills = () => bars.map((bar) => parseFloat(bar.querySelector<HTMLElement>('span > span')!.style.width));
      const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
      await waitFor(() => expect(fills()).toEqual([100, 100, 100]));
      time = 0;
      await frame();
      await frame();
      expect(fills()).toEqual([0, 0, 0]);
      fireEvent.click(bars[2]!);
      await frame();
      await frame();
      const gliding = fills();
      expect(gliding[0]).toBeGreaterThan(0);
      expect(gliding[0]).toBeLessThan(100);
      await waitFor(() => expect(fills()).toEqual([100, 100, 0]));
    } finally {
      vi.unstubAllGlobals();
      __resetReelTimings();
    }
  });

  /** Walks to the summary with every box measuring `w` by `h` px, and counts the confetti that falls. */
  const confettiOver = async (w: number, h: number): Promise<number> => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(w);
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(h);
    try {
      startTour();
      mountTips('pc', false);
      for (let i = 0; i < tourCards(true).length; i++) await press(en('tour.next'));
      return (await screen.findByTestId('tour-confetti')).childElementCount;
    } finally {
      width.mockRestore();
      height.mockRestore();
      cleanup();
      act(() => { useEditorStore.getState().finishTour(); });
    }
  };

  spec('UI-53', 'the confetti falls as densely over a large window as a small one, up to a limit', async () => {
    const phone = await confettiOver(350, 560);
    const desktop = await confettiOver(900, 440);
    const huge = await confettiOver(3000, 2000);
    expect(desktop).toBeGreaterThan(phone);
    expect(huge).toBeGreaterThan(desktop);
    expect(await confettiOver(6000, 4000)).toBe(huge);
  });

  spec('UI-53', 'under reduced motion no confetti falls', async () => {
    startTour();
    mountTips();
    for (let i = 0; i < tourCards(true).length; i++) await press(en('tour.next'));
    expect(screen.getByTestId('tour-recap')).toBeTruthy();
    expect(screen.queryByTestId('tour-confetti')).toBeNull();
  });
});

describe('the reels', () => {
  spec('UI-49', 'a locale without its own recordings plays the English ones', async () => {
    const shipped = REEL_FILES;
    // Every shipped locale has its own set, so the fallback is shown with a table that lacks Thai.
    __setReelFiles(Object.fromEntries(Object.entries(shipped).filter(([path]) => !path.startsWith('th/'))));
    try {
      const english = reelFiles('en', 'touch-tall', 'welcome');
      expect(english?.webm).toBeTruthy();
      expect(english?.poster).toBeTruthy();
      expect(reelFiles('th', 'touch-tall', 'welcome')).toEqual(english);
    } finally { __setReelFiles(null); }
  });

  spec('UI-49', 'every locale ships its own reel, poster and timing for every card in every form', () => {
    const forms = ['mouse-land', 'mouse-tall', 'touch-tall', 'touch-land'] as const;
    const missing = LOCALES.flatMap((locale) => forms.flatMap((form) => TOUR_KINDS.flatMap((kind) =>
      ['webm', 'mp4', 'jpg'].map((ext) => `${locale}/${form}/${kind}.${ext}`).concat(`${locale}/${form}/reels.json`)
        .filter((path) => !REEL_FILES[path]))));
    expect([...new Set(missing)]).toEqual([]);
  });

  spec('UI-49', 'under reduced motion a reel rests on its poster with a play button', async () => {
    startTour();
    mountTips('pc', true);
    const video = screen.getByTestId('tour-reel-clip-video') as HTMLVideoElement;
    expect(video.autoplay).toBe(false);
    expect(video.getAttribute('poster')).toBeTruthy();
    expect(screen.getByTestId('tour-reel-clip-play')).toBeTruthy();
  });

  spec('UI-49', 'a reel that plays on its own never shows its picture of the end while it loads, on any card', async () => {
    startTour();
    mountTips('pc', false);
    const videos = () => screen.getAllByTestId('tour-reel-clip-video') as HTMLVideoElement[];
    expect(videos()[0]!.autoplay).toBe(true);
    expect(videos().map((v) => v.getAttribute('poster'))).toEqual([null]);
    await press(en('tour.next'));
    // The arriving card's clip, and the leaving one's as it crosses out.
    expect(videos().map((v) => v.getAttribute('poster')).every((p) => p === null)).toBe(true);
  });

  spec('UI-49', 'a reel that cannot load shows its poster and the card still works', async () => {
    startTour();
    mountTips();
    const sources = screen.getByTestId('tour-reel-clip-video').querySelectorAll('source');
    fireEvent.error(sources[sources.length - 1]!);
    expect(screen.getByTestId('tour-reel-clip-poster')).toBeTruthy();
    await press(en('tour.next'));
    await onCard('tour.move_title');
  });

  spec('UI-49', 'an engine without AV1 plays the H.264 copy', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) => (type.startsWith('video/mp4') ? 'probably' : ''));
    const files = reelFiles('en', 'mouse-land', 'welcome')!;
    expect(playedReel(files)).toBe(files.mp4);
    startTour();
    mountTips();
    const offered = [...screen.getByTestId('tour-reel-clip-video').querySelectorAll('source')].map((el) => [el.getAttribute('src'), el.getAttribute('type')]);
    expect(offered).toContainEqual([files.mp4, REEL_TYPES.mp4]);
  });

  spec('UI-52', 'the opening reel stays on the warm list after the first-launch check has recorded the offer', async () => {
    const files = reelFiles('en', 'mouse-land', 'welcome')!;
    setStoreState({ inputMode: 'pc', layoutShape: 'landscape' });
    renderHook(() => useFirstLaunchTour(false));
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe(String(TOUR_VERSION));
    expect(tourWarmFiles()).toEqual(expect.arrayContaining([files.poster]));
  });

  spec('UI-52', 'the loading screen fetches the opening reel only on a visit that opens the tips', async () => {
    const files = reelFiles('en', 'mouse-land', 'welcome')!;
    setStoreState({ inputMode: 'pc', layoutShape: 'landscape' });
    expect(tourWarmFiles()).toEqual(expect.arrayContaining([files.poster]));
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    expect(tourWarmFiles()).toEqual([]);
  });

  spec('UI-52', 'opened under the loading screen, the first reel waits on its start and plays from its beginning as the screen lifts', () => {
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    const view = (stage: HandoffStage) => <EditorRoot dockRef={NO_DOCK} onRestoreSession={() => {}} plane={{ handoff: stage }}><div /></EditorRoot>;
    const { rerender } = render(view('covered'));
    act(() => startTour());
    const video = screen.getByTestId('tour-reel-clip-video') as HTMLVideoElement;
    let time = 2.5;
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: (v: number) => { time = v; } });
    const played: number[] = [];
    video.play = () => { played.push(time); return Promise.resolve(); };
    expect(video.autoplay, 'not playing under the screen').toBe(false);
    expect(video.preload, 'still loading under the screen').toBe('auto');
    expect(screen.queryByTestId('tour-reel-clip-play'), 'no play button').toBeNull();
    rerender(view('leaving'));
    expect(played).toEqual([0]);
    rerender(view('none'));
    expect(played).toEqual([0]);
  });
});

/** jsdom has no PointerEvent, so a pointer event's coordinates and kind would not reach the handlers. */
function stubPointerEvents(): void {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number; isPrimary: boolean; pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  });
}

describe('a swipe across a card', () => {
  beforeEach(stubPointerEvents);
  afterEach(() => { vi.unstubAllGlobals(); });
  const screenOf = () => deck().querySelector<HTMLElement>('[data-tour-screen]')!;
  const wordsPart = () => [...deck().querySelectorAll<HTMLElement>('[data-tour-swipe]')].find((el) => !el.closest('[data-leaving]') && el.querySelector('[data-tour-words]'))!;
  /** Drags a finger from the first point through the rest, `ms` apart, on `target` (the card's words by default). */
  const drag = (points: readonly [number, number][], { ms = 16, lift = true, target }: { ms?: number; lift?: boolean; target?: HTMLElement } = {}) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const on = target ?? within(deck()).getByRole('heading');
    const [x0, y0] = points[0]!;
    act(() => { fireEvent.pointerDown(on, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: x0, clientY: y0 }); });
    for (const [x, y] of points.slice(1)) {
      now += ms;
      act(() => { fireEvent.pointerMove(on, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y }); });
    }
    const [x1, y1] = points.at(-1)!;
    now += ms;
    if (lift) act(() => { fireEvent.pointerUp(on, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: x1, clientY: y1 }); });
    clock.mockRestore();
  };
  const cards = tourCards(true);
  /** A slow drag along x from 300 by `to`, in 10 px steps a frame apart. */
  const slow = (to: number) => Array.from({ length: Math.abs(to) / 10 + 1 }, (_, i) => [300 + Math.sign(to) * i * 10, 400] as [number, number]);

  spec('UI-56', 'in touch mode a swipe to the left turns to the next card and one to the right back, as Next and Back do', async () => {
    startTour();
    mountTips('touch');
    await onCard(cards[0]!.titleKey);
    drag(slow(-140));
    await onCard(cards[1]!.titleKey);
    drag(slow(140));
    await onCard(cards[0]!.titleKey);
  });

  spec('UI-56', 'a short slow swipe leaves the card where it is, and a short quick flick turns it', async () => {
    startTour();
    mountTips('touch');
    await onCard(cards[0]!.titleKey);
    drag(slow(-30), { ms: 120 });
    await settled();
    expect(title(), 'too short and slow to turn').toBe(en(cards[0]!.titleKey));
    drag([[300, 400], [290, 400], [270, 400]], { ms: 16 });
    await onCard(cards[1]!.titleKey);
  });

  spec('UI-56', 'a drag that sets off vertically stays the words\' scroll and never turns, however far it then goes sideways', async () => {
    startTour();
    mountTips('touch');
    await onCard(cards[0]!.titleKey);
    drag([[300, 400], [301, 390], [302, 380], [250, 380], [150, 380]]);
    await settled();
    expect(title()).toBe(en(cards[0]!.titleKey));
  });

  spec('UI-56', 'a tap on the demonstration is no swipe, and a swipe that starts on it turns the card without enlarging it', async () => {
    startTour();
    mountTips('touch');
    await onCard(cards[0]!.titleKey);
    const reel = screen.getByTestId('tour-reel-enlarge');
    drag([[300, 400], [303, 401]], { target: reel });
    act(() => { fireEvent.click(reel); });
    expect(reel.getAttribute('aria-expanded'), 'the tap enlarges it').toBe('true');
    act(() => { fireEvent.click(reel); });
    drag(slow(-140), { target: screen.getByTestId('tour-reel-enlarge') });
    await onCard(cards[1]!.titleKey);
    expect(screen.queryByTestId('tour-reel-plate')).toBeNull();
  });

  spec('UI-56', 'the first card has nothing before it and the last card\'s swipe to the left reaches the summary', async () => {
    startTour();
    mountTips('touch');
    await onCard(cards[0]!.titleKey);
    drag(slow(160));
    await settled();
    expect(title()).toBe(en(cards[0]!.titleKey));
    act(() => { useEditorStore.getState().setTourPhase({ kind: 'deck', card: cards.length - 1 }); });
    await onCard(cards.at(-1)!.titleKey);
    drag(slow(-140));
    await waitFor(() => expect(screen.getByTestId('tour-recap')).toBeTruthy());
  });

  spec('UI-56', 'the card\'s words follow the finger while it drags and spring back when it lets go short of a turn', async () => {
    startTour();
    mountTips('touch', false);
    await settled();
    drag(slow(-40), { lift: false, ms: 120 });
    const zoom = Number(deck().style.zoom) || 1;
    expect(parseFloat(wordsPart().style.getPropertyValue('--tour-swipe'))).toBeCloseTo(-40 / zoom, 3);
    const at = wordsPart();
    act(() => { fireEvent.pointerUp(screenOf(), { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 260, clientY: 400 }); });
    await waitFor(() => expect(Math.abs(parseFloat(at.style.getPropertyValue('--tour-swipe')) || 0)).toBeLessThan(0.5), { timeout: 3000 });
    expect(title()).toBe(en(cards[0]!.titleKey));
  });

  spec('UI-56', 'a mouse drag turns nothing: PC mode keeps its buttons and keys', async () => {
    startTour();
    mountTips('pc');
    await onCard(cards[0]!.titleKey);
    drag(slow(-160));
    await settled();
    expect(title()).toBe(en(cards[0]!.titleKey));
  });
});

describe('an enlarged reel', () => {
  const toggle = () => screen.getByTestId('tour-reel-enlarge');
  const video = () => screen.getByTestId('tour-reel-clip-video') as HTMLVideoElement;
  /** Opens the tips with the clip standing at `at` seconds and returns the clip element. */
  const openAt = (at: number, reduced = true): HTMLVideoElement => {
    startTour();
    mountTips('pc', reduced);
    const clip = video();
    let time = at;
    Object.defineProperty(clip, 'currentTime', { configurable: true, get: () => time, set: (v: number) => { time = v; } });
    return clip;
  };

  spec('UI-55', 'a press enlarges the reel out of the card and another puts it back, the same clip at the same time throughout', async () => {
    const clip = openAt(4.2);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe(en('tour.reel_enlarge'));
    act(() => fireEvent.click(toggle()));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe(en('tour.reel_restore'));
    expect(deck().contains(video()), 'out of the card').toBe(false);
    expect(within(deck()).getByRole('heading').textContent, 'the card stays').toBe(en('tour.welcome_title'));
    expect(video()).toBe(clip);
    expect(video().currentTime).toBe(4.2);
    expect(document.activeElement).toBe(toggle());
    act(() => fireEvent.click(toggle()));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(deck().contains(video()), 'back in the card').toBe(true);
    expect(video()).toBe(clip);
    expect(video().currentTime).toBe(4.2);
    expect(document.activeElement, 'focus back on the reel').toBe(toggle());
  });

  spec('UI-55', 'Escape puts the enlarged reel back before it closes the tips', async () => {
    openAt(0);
    act(() => fireEvent.click(toggle()));
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('tour-deck')).toBeTruthy();
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByTestId('tour-deck')).toBeNull());
  });

  spec('UI-55', 'under reduced motion the reel changes size at once, with no glide', () => {
    openAt(0);
    act(() => fireEvent.click(toggle()));
    expect(screen.getByTestId('tour-reel-plate'), 'enlarged at once').toBeTruthy();
    expect(deck().contains(video())).toBe(false);
    act(() => fireEvent.click(toggle()));
    expect(deck().contains(video()), 'back at once').toBe(true);
    expect(screen.queryByTestId('tour-reel-plate')).toBeNull();
  });

  spec('UI-55', 'a press while the reel shrinks back turns it round, and it stays enlarged', async () => {
    // Frames held back keep the shrink from landing until the second press has turned it round.
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const clip = openAt(3.1, false);
    act(() => fireEvent.click(toggle()));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    act(() => fireEvent.click(toggle()));
    expect(toggle().getAttribute('aria-expanded'), 'shrinking').toBe('false');
    expect(deck().contains(video()), 'still out of the card while it shrinks').toBe(false);
    act(() => fireEvent.click(toggle()));
    expect(toggle().getAttribute('aria-expanded'), 'turned round').toBe('true');
    vi.mocked(window.requestAnimationFrame).mockRestore();
    await act(async () => { for (const cb of frames.splice(0)) cb(performance.now()); await Promise.resolve(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(deck().contains(video()), 'the turned-round shrink never puts it back').toBe(false);
    expect(screen.getByTestId('tour-reel-plate')).toBeTruthy();
    expect(video()).toBe(clip);
    act(() => fireEvent.click(toggle()));
    await waitFor(() => expect(deck().contains(video()), 'a shrink left to run lands in the card').toBe(true));
  });

  spec('UI-55', 'the enlarged reel is capped at its recording and a share of the window, and offered only where it gains a quarter', () => {
    const tall = { w: 360, h: 780 };
    const wide = { w: 960, h: 600 };
    // An upright phone's sheet frame, at a lift zoom of 1: the plate within four fifths of the window.
    const phone = reelEnlargement({ w: 390, h: 844 }, 1, { w: 130, h: 281 }, tall)!;
    expect(phone).not.toBeNull();
    expect(phone.w / phone.h).toBeCloseTo(tall.w / tall.h, 6);
    expect(phone.h).toBeLessThan(844 * 0.8);
    expect(phone.w).toBeLessThan(tall.w);
    // A large window shows it at its recorded size and no larger, at any zoom.
    expect(reelEnlargement({ w: 1920, h: 1080 }, 1, { w: 448, h: 280 }, wide)!.w).toBeCloseTo(960, 6);
    expect(reelEnlargement({ w: 1920, h: 1080 }, 1.5, { w: 300, h: 187.5 }, wide)!.w * 1.5).toBeCloseTo(960, 6);
    expect(reelEnlargement({ w: 820, h: 1180 }, 1, { w: 251, h: 543 }, tall)!.w).toBeCloseTo(360, 6);
    // A short window keeps the shorter side readable where its margin allows, past the share.
    const short = reelEnlargement({ w: 844, h: 390 }, 1, { w: 300, h: 138 }, { w: 780, h: 360 })!;
    expect(short.h).toBeGreaterThanOrEqual(240);
    expect(short.h).toBeLessThanOrEqual(390 - 2 * 16);
    // A frame that would grow by less than a quarter is not offered: near its recorded size, or in a window no larger.
    expect(reelEnlargement({ w: 2000, h: 2000 }, 1, { w: 300, h: 650 }, tall)).toBeNull();
    expect(reelEnlargement({ w: 160, h: 340 }, 1, { w: 130, h: 281 }, tall)).toBeNull();
  });

  spec('UI-55', 'pointed at, the demonstration and its corner tab grow together as one control', async () => {
    stubPointerEvents();
    openAt(0);
    const press = toggle().closest<HTMLElement>('[data-tour-reel-press]')!;
    expect(press.contains(screen.getByTestId('tour-reel-tab')), 'the tab stands inside what the hover scales').toBe(true);
    act(() => { fireEvent.pointerEnter(press, { pointerType: 'mouse' }); });
    await waitFor(() => expect(press.style.transform).toContain('scale(1.01)'));
  });

  spec('UI-55', 'enlarged, the tab, its sign, the bars and the caption grow with the demonstration, each within its bound', async () => {
    openAt(0);
    const tab = () => screen.getByTestId('tour-reel-tab');
    const sign = () => tab().querySelector('svg')!;
    // The bars' row, holding its room while the clip's timing loads.
    const bar = () => screen.getByTestId('tour-reel').children[1] as HTMLElement;
    const caption = () => screen.getByTestId('tour-reel').lastElementChild as HTMLElement;
    const card = { tab: parseFloat(tab().style.width), sign: Number(sign().getAttribute('width')), bar: parseFloat(bar().style.height), caption: parseFloat(caption().style.fontSize) };
    const frame = parseFloat(toggle().closest<HTMLElement>('[data-tour-reel-press]')!.style.width);
    act(() => fireEvent.click(toggle()));
    const k = parseFloat(toggle().closest<HTMLElement>('[data-tour-reel-press]')!.style.width) / frame;
    expect(k).toBeGreaterThanOrEqual(1.25);
    const tabGrew = parseFloat(tab().style.width) / card.tab;
    expect(tabGrew).toBeCloseTo(Math.min(k, 1.75), 6);
    expect(Number(sign().getAttribute('width')) / card.sign, 'the sign grows with its tab').toBeCloseTo(tabGrew, 6);
    const footGrew = parseFloat(caption().style.fontSize) / card.caption;
    expect(footGrew).toBeCloseTo(Math.min(k, 1.5), 6);
    expect(parseFloat(bar().style.height) / card.bar, 'the bars grow with the caption').toBeCloseTo(footGrew, 6);
  });

  spec('UI-55', 'the enlarged tab is a fingertip across in touch mode, and the caption grows no more than half again', () => {
    for (const [k, zoom, radius] of [[1.3, 1.29, 8.6], [2.2, 1, 16], [1.26, 0.9, 6]] as const) {
      const { foot, tab } = enlargedScales(k, zoom, radius, 44);
      expect(foot).toBeLessThanOrEqual(1.5);
      expect(foot).toBeLessThanOrEqual(k);
      expect(reelTab(radius) * tab * zoom).toBeGreaterThanOrEqual(44 - 1e-9);
    }
  });

  /** The weight an element's text stands at: a role's weight variable read off the nearest surface
   *  publishing it, or its fallback, as the browser resolves it. */
  const weightOf = (el: HTMLElement): string => {
    const named = /^var\((--[\w-]+),\s*([^)]+)\)$/.exec(el.style.fontWeight);
    if (!named) return el.style.fontWeight;
    for (let at: HTMLElement | null = el; at; at = at.parentElement) {
      const value = at.style.getPropertyValue(named[1]!);
      if (value) return value.trim();
    }
    return named[2]!.trim();
  };

  spec('UI-55', 'the demonstration\'s caption keeps one size and weight in every input mode and shape, in the card and enlarged', async () => {
    const forms = [['pc', 'landscape', 1440, 900], ['touch', 'landscape', 1180, 820], ['touch', 'portrait', 390, 844], ['pc', 'portrait', 800, 1100]] as const;
    const seen: string[] = [];
    const sizes = new Set<string>();
    try {
      for (const [inputMode, shape, w, h] of forms) {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
        startTour();
        render(
          <MotionConfig reducedMotion="always">
            <I18nProvider><InputModeProvider inputMode={inputMode} shape={shape}><Tour /></InputModeProvider></I18nProvider>
          </MotionConfig>,
        );
        await settled();
        const caption = () => screen.getByTestId('tour-reel').lastElementChild as HTMLElement;
        sizes.add(caption().style.fontSize);
        seen.push(`${inputMode} ${shape} card: ${weightOf(caption())}`);
        const enlarge = screen.queryByTestId('tour-reel-enlarge');
        if (enlarge) {
          act(() => fireEvent.click(enlarge));
          seen.push(`${inputMode} ${shape} enlarged: ${weightOf(caption())}`);
        }
        cleanup();
        act(() => { useEditorStore.getState().finishTour(); });
      }
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    }
    expect(seen.some((s) => s.includes('enlarged')), 'some form offers enlarging').toBe(true);
    expect(new Set(seen.map((s) => s.split(': ')[1])), seen.join('\n')).toHaveLength(1);
    expect([...sizes], 'one size in every card').toHaveLength(1);
  });

  spec('UI-55', 'lifting off and landing back, the plate holds the card\'s frame, bars and caption at the enlarged plate\'s proportions', () => {
    const pad = 12;
    // A desktop frame whose caption grows less than it does, and an upright sheet's whose bars are wider than it.
    for (const { frame, foot, span, enlarged, grown } of [
      { frame: { w: 448, h: 280 }, foot: 49, span: 448, enlarged: { w: 960, h: 600 }, grown: 73.5 },
      { frame: { w: 89, h: 118 }, foot: 55, span: 240, enlarged: { w: 201, h: 268 }, grown: 120 },
      { frame: { w: 210, h: 281 }, foot: 55, span: 240, enlarged: { w: 280, h: 374 }, grown: 90 },
    ]) {
      const plate = { w: enlarged.w + 2 * pad, h: enlarged.h + grown + 2 * pad };
      const s = liftedPlateShrink(frame, foot, span, enlarged, plate);
      expect(plate.w * s - 2 * pad * s, 'it holds the frame').toBeGreaterThanOrEqual(frame.w - 1e-9);
      expect(plate.w * s - 2 * pad * s, 'it holds the bars and caption').toBeGreaterThanOrEqual(span - 1e-9);
      expect(plate.h * s - 2 * pad * s, 'it holds the frame and its foot').toBeGreaterThanOrEqual(frame.h + foot - 1e-9);
      // The least that holds them: one of the three fits exactly.
      expect(Math.min(plate.w * s - 2 * pad * s - Math.max(frame.w, span), plate.h * s - 2 * pad * s - frame.h - foot)).toBeCloseTo(0, 6);
    }
  });

  spec('UI-55', 'the enlarged plate\'s foot rounds clear of a caption a pad in from its corner', () => {
    openAt(0);
    act(() => fireEvent.click(toggle()));
    const plate = screen.getByTestId('tour-reel-plate');
    const pad = (parseFloat(plate.style.width) - parseFloat(toggle().closest<HTMLElement>('[data-tour-reel-press]')!.style.width)) / 2;
    expect(pad).toBeGreaterThan(0);
    const [, , foot] = plate.style.borderRadius.split(' ').map(parseFloat);
    // The caption's line box corner, `pad` in on each side, stands on or inside the corner's arc.
    expect((foot! - pad) * Math.SQRT2, `radius ${plate.style.borderRadius}`).toBeLessThanOrEqual(foot!);
  });

  spec('UI-55', 'the corner tab stays inside the frame\'s rounded corner at every size', () => {
    for (const [w, h] of [[130, 281], [268, 581], [448, 280], [960, 600]] as const) {
      const r = reelRadius(w, h);
      expect(reelTab(r)).toBeGreaterThanOrEqual(r);
      expect(reelTab(r)).toBeLessThan(Math.min(w, h) / 2);
    }
  });
});

describe('Show me on the live shell', () => {
  beforeEach(() => {
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 100, width: 200, height: 120, left: 100, top: 100, right: 300, bottom: 220, toJSON: () => ({}),
    } as DOMRect);
  });

  const shell = (inputMode: InputMode = 'pc') => render(
    <I18nProvider><InputModeProvider inputMode={inputMode}><Shell onRestoreSession={() => {}}><div /></Shell></InputModeProvider></I18nProvider>,
  );
  const showMe = async (kind: string) => {
    act(() => startTour());
    const at = tourCards(true).findIndex((c) => c.kind === kind);
    await press(en('tour.dot', { n: at + 1, total: tourCards(true).length }));
    act(() => fireEvent.click(screen.getByTestId('tour-show-me')));
  };
  const callout = () => screen.getByTestId('tour-callout');
  /** The live control a step rings, pressed as the visitor would. */
  const pressTarget = (id: TourTargetId) => act(() => fireEvent.click(document.querySelector<HTMLElement>(tourTargetSelector(id))!));

  spec('UI-47', 'a step waits for the visitor to press the real control, moves on once they have, and gives back the mode it borrowed', async () => {
    shell();
    await showMe('shape');
    await waitFor(() => expect(callout().textContent).toContain(en('tour.show.mountain_open')));
    expect(useEditorStore.getState().editMode.mode).toBeNull();
    pressTarget('mode:mountain');
    expect(useEditorStore.getState().editMode.mode).toBe('mountain');
    await waitFor(() => expect(callout().textContent).toContain(en('tour.show.mountain_paint')));
    await backToTips();
    expect(useEditorStore.getState().editMode.mode).toBeNull();
    await onCard('tour.shape_title');
  });

  spec('UI-47', 'the 3D card\'s Show me moves on as the view switches, and returns the view to 2D however it ends', async () => {
    shell();
    await showMe('view3d');
    await waitFor(() => expect(callout().textContent).toContain(en('tour.show.view3d_switch')));
    pressTarget('view3d');
    await waitFor(() => expect(useEditorStore.getState().viewMode).toBe('3d'));
    await waitFor(() => expect(callout().textContent).toContain(en('tour.show.view3d_turn')));
    act(() => { useEditorStore.getState().finishTour(); });
    expect(useEditorStore.getState().viewMode).toBe('2d');
  });

  spec('UI-47', 'in touch mode the 3D card leaves out the tilt, which no finger gesture makes', async () => {
    const steps = tourCards(true).find((c) => c.kind === 'view3d')!.show!;
    shell('touch');
    await showMe('view3d');
    pressTarget('view3d');
    await waitFor(() => expect(callout().textContent).toContain(en('tour.show.view3d_turn_touch')));
    const offered = steps.filter((step) => step.input !== 'pc').length;
    expect(offered).toBeLessThan(steps.length);
    expect(callout().textContent).toContain(en('tour.progress', { n: 2, total: offered }));
  });

  spec('UI-47', 'the assistant card has no Show me; every other card after the welcome has one', async () => {
    const cards = tourCards(true);
    expect(cards.find((c) => c.kind === 'assistant')?.show).toBeUndefined();
    for (const card of cards.filter((c) => c.kind !== 'welcome' && c.kind !== 'assistant')) expect(card.show?.length, card.kind).toBeGreaterThan(0);
    startTour();
    mountTips();
    await press(en('tour.dot', { n: cards.findIndex((c) => c.kind === 'assistant') + 1, total: cards.length }));
    await onCard('tour.assistant_title');
    expect(screen.queryByTestId('tour-show-me')).toBeNull();
  });
});

describe('what the visitor builds while trying', () => {
  beforeEach(() => {
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 100, width: 200, height: 120, left: 100, top: 100, right: 300, bottom: 220, toJSON: () => ({}),
    } as DOMRect);
    useEditorStore.getState().initMap(getMapTemplate('hexia'), createDefaultRegistry());
  });

  const live = () => useEditorStore.getState();
  /** One brush stroke raising `cell` a layer, as the live brush lays it; whether the map took it. */
  const raise = (cell: MacroCoord): boolean => {
    const executor = live().commandExecutor!;
    const depth = executor.historyDepth();
    executor.transaction({}, (tx) => {
      executor.execute(paintTerrainCommand([cell], TerrainType.Mountain, 1));
      tx.commit();
    });
    return executor.historyDepth() > depth;
  };
  /** The next open ground cell a stroke can raise, row by row. */
  const nextRaise = (() => {
    let at = 0;
    return (): MacroCoord => {
      const { cells } = live().gridState!;
      for (; at < cells.length * cells[0]!.length; at++) {
        const cell = { x: at % cells[0]!.length, y: Math.floor(at / cells[0]!.length) };
        if (raise(cell)) { at++; return cell; }
      }
      throw new Error('no ground left to raise');
    };
  })();

  spec('UI-47', 'comes off again when Show me ends, the undo and redo history put back as they stood', async () => {
    render(<I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider>);
    nextRaise();
    nextRaise();
    const built = mapFingerprint(live().gridState!);
    act(() => { live().commandExecutor!.undo(); });
    const before = mapFingerprint(live().gridState!);
    const depth = live().commandExecutor!.historyDepth();
    act(() => startTour());
    const at = tourCards(true).findIndex((c) => c.kind === 'shape');
    await press(en('tour.dot', { n: at + 1, total: tourCards(true).length }));
    act(() => fireEvent.click(screen.getByTestId('tour-show-me')));
    act(() => fireEvent.click(document.querySelector<HTMLElement>(tourTargetSelector('mode:mountain'))!));
    await waitFor(() => expect(screen.getByTestId('tour-callout').textContent).toContain(en('tour.show.mountain_paint')));
    act(() => { nextRaise(); });
    await waitFor(() => expect(screen.getByTestId('tour-callout').textContent).toContain(en('tour.show.mountain_erase')));
    // Undone past where Show me began, then built on: the history parted from the one it found.
    act(() => { live().commandExecutor!.undo(); live().commandExecutor!.undo(); nextRaise(); });
    expect(mapFingerprint(live().gridState!)).not.toBe(before);
    await backToTips();
    expect(mapFingerprint(live().gridState!)).toBe(before);
    expect(live().commandExecutor!.historyDepth()).toBe(depth);
    act(() => { live().commandExecutor!.redo(); });
    expect(mapFingerprint(live().gridState!)).toBe(built);
  });
});

describe('review regressions', () => {
  spec('UI-38', 'a pictured shell, as Help draws it, never opens the tips, even for a browser offered the older tour', () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    render(<MotionConfig reducedMotion="always"><I18nProvider><TourPreview /></I18nProvider></MotionConfig>);
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  spec('UI-45', 'the way on takes focus as each screen arrives: the summary\'s Start building, then a card\'s Next', async () => {
    startTour();
    mountTips();
    for (let i = 0; i < tourCards(true).length; i++) await press(en('tour.next'));
    await waitFor(() => expect(document.activeElement?.textContent).toBe(en('tour.start')));
    fireEvent.click(screen.getByRole('button', { name: en('tour.recap_tile', { tip: en('tour.shape_tile') }) }));
    await onCard('tour.shape_title');
    expect(document.activeElement?.textContent).toBe(en('tour.next'));
  });

  spec('UI-47', 'Show me stands down while a note is being written, so it never asks to discard it', async () => {
    setStoreState({ annotationDraft: { id: 'draft' } as MapAnnotation });
    startTour();
    mountTips();
    await press(en('tour.next'));
    await press(en('tour.next'));
    await settled();
    fireEvent.click(screen.getByTestId('tour-show-me'));
    expect(screen.queryByTestId('tour-callout')).toBeNull();
    expect(useEditorStore.getState().annotationDiscardAction).toBeNull();
    setStoreState({ annotationDraft: null });
  });

  spec('UI-47', 'Show me waits for a build still landing, so what it gives back never holds half of one', async () => {
    const release = holdEditInFlight(() => {}, 'build');
    startTour();
    mountTips();
    await press(en('tour.next'));
    await press(en('tour.next'));
    await settled();
    expect(screen.getByTestId('tour-show-me').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByTestId('tour-show-me'));
    act(() => { useEditorStore.getState().setTourPhase({ kind: 'show', card: 2, step: 0 }); });
    expect(useEditorStore.getState().tourPhase.kind).toBe('deck');
    act(() => release());
    expect(screen.getByTestId('tour-show-me').getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(screen.getByTestId('tour-show-me'));
    expect(useEditorStore.getState().tourPhase.kind).toBe('show');
  });

  spec('UI-49', 'while the browser saves data, a reel played by hand fetches nothing ahead', async () => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
    const fetched = vi.fn(async (_url: RequestInfo | URL) => new Response(''));
    vi.stubGlobal('fetch', fetched);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    try {
      startTour();
      mountTips('pc', false);
      fireEvent.click(screen.getByTestId('tour-reel-clip-play'));
      fireEvent(screen.getByTestId('tour-reel-clip-video'), new Event('playing'));
      const next = reelFiles('en', 'mouse-land', 'move')!;
      const ahead = [playedReel(next), next.poster];
      expect(fetched.mock.calls.map(([url]) => String(url)).filter((url) => ahead.includes(url))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
    }
  });
});

describe('Show me over the window it opens', () => {
  beforeEach(() => {
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 100, width: 200, height: 120, left: 100, top: 100, right: 300, bottom: 220, toJSON: () => ({}),
    } as DOMRect);
  });

  spec('UI-47', 'Escape over the Save and share window it opened returns to the card and closes the window', async () => {
    render(<I18nProvider><Shell onRestoreSession={() => {}}><div /></Shell></I18nProvider>);
    act(() => startTour());
    const at = tourCards(true).findIndex((c) => c.kind === 'share');
    await press(en('tour.dot', { n: at + 1, total: tourCards(true).length }));
    fireEvent.click(screen.getByTestId('tour-show-me'));
    await waitFor(() => expect(screen.getByTestId('tour-callout').textContent).toContain(en('tour.show.share_open')));
    act(() => fireEvent.click(document.querySelector<HTMLElement>(tourTargetSelector('share'))!));
    await waitFor(() => expect(useEditorStore.getState().modals.share).toBe(true));
    await waitFor(() => expect(screen.getByTestId('tour-callout').textContent).toContain(en('share.tab_keep')));
    await waitFor(() => expect(screen.getByTestId('tour-callout').contains(document.activeElement)).toBe(true));
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    await onCard('tour.share_title');
    expect(useEditorStore.getState().modals.share).toBe(false);
  });
});

describe('how a Show me step knows it is done', () => {
  const stepOf = (kind: string, id: string) => tourCards(true).find((c) => c.kind === kind)!.show!.find((s) => s.id === id)!;
  const flat = (camera: { x: number; y: number; zoom: number }, fit = { x: 0, y: 0, zoom: 1 }): TourWatch => ({
    view: '2d', mode: null, arming: 'none', layer: 0, share: false, edits: 0, building: false, camera2d: camera, fit2d: fit, camera3d: null,
  });
  const untried = { fit: false };

  spec('UI-47', 'the pan step counts a move across the map, never a zoom, wherever it is aimed', () => {
    const step = stepOf('move', 'pan');
    /** Whether the step counts a run of camera readings, each one taken as the map moves. */
    const counts = (readings: TourWatch[]): boolean => {
      let from = readings[0]!;
      for (let i = 1; i < readings.length; i++) {
        if (step.rebase?.(readings[i - 1]!, readings[i]!)) from = readings[i]!;
        if (step.done!(from, readings[i]!, untried)) return true;
      }
      return false;
    };
    /** The camera a zoom by `k` about screen point (qx, qy) of a camera at offset 0 and zoom 1 lands on. */
    const zoomedAbout = (k: number, qx: number, qy: number) => flat({ x: qx * (k - 1), y: qy * (k - 1), zoom: k });
    const rest = flat({ x: 0, y: 0, zoom: 1 });
    // Three wheel notches at a cursor near the corner, then twice about the centre.
    expect(counts([rest, zoomedAbout(1.1, 760, 40), zoomedAbout(1.21, 760, 40), zoomedAbout(1.331, 760, 40)])).toBe(false);
    expect(counts([rest, zoomedAbout(2.1, 400, 300)])).toBe(false);
    expect(counts([rest, flat({ x: 60, y: 0, zoom: 1 })])).toBe(true);
    // A drag after the zoom counts from where the zoom left the map.
    const zoomed = zoomedAbout(1.331, 760, 40);
    expect(counts([rest, zoomed, flat({ x: zoomed.camera2d!.x - 30, y: zoomed.camera2d!.y, zoom: 1.331 })])).toBe(false);
    expect(counts([rest, zoomed, flat({ x: zoomed.camera2d!.x - 60, y: zoomed.camera2d!.y, zoom: 1.331 })])).toBe(true);
  });

  spec('UI-47', 'the Fit step counts the camera landing fitted, and a view fitted already waits for Fit itself', () => {
    const fit = stepOf('move', 'fit').done!;
    const fitted = { x: 10, y: 20, zoom: 0.8 };
    const away = flat({ x: 200, y: 20, zoom: 0.8 }, fitted);
    const home = flat({ x: 10, y: 20, zoom: 0.8 }, fitted);
    // A pinch's tail or an arrow pan moves the camera without fitting it.
    expect(fit(away, flat({ x: 230, y: 20, zoom: 0.9 }, fitted), untried)).toBe(false);
    expect(fit(away, home, untried)).toBe(true);
    expect(fit(home, home, untried)).toBe(false);
    expect(fit(home, home, { fit: true })).toBe(true);
  });
});

describe('Show me, step by step on the live shell', () => {
  beforeEach(() => {
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 100, width: 200, height: 120, left: 100, top: 100, right: 300, bottom: 220, toJSON: () => ({}),
    } as DOMRect);
    useEditorStore.getState().initMap(getMapTemplate('hexia'), createDefaultRegistry());
  });

  const live = () => useEditorStore.getState();
  const shell = (inputMode: InputMode = 'pc') => render(
    <I18nProvider><InputModeProvider inputMode={inputMode}><Shell onRestoreSession={() => {}}><div /></Shell></InputModeProvider></I18nProvider>,
  );
  const showMe = async (kind: string) => {
    act(() => startTour());
    const at = tourCards(true).findIndex((c) => c.kind === kind);
    await press(en('tour.dot', { n: at + 1, total: tourCards(true).length }));
    act(() => fireEvent.click(screen.getByTestId('tour-show-me')));
  };
  const callout = () => screen.getByTestId('tour-callout');
  const standsAt = (key: Parameters<typeof translateFor>[1]) => waitFor(() => expect(callout().textContent).toContain(en(key)));
  const pressTarget = (id: TourTargetId) => act(() => fireEvent.click(document.querySelector<HTMLElement>(tourTargetSelector(id))!));
  const nextStep = () => act(() => fireEvent.click(within(callout()).getByRole('button', { name: en('tour.next') })));
  /** One stroke raising the first open ground cell a layer, as the live brush lays it. */
  const raise = (): void => {
    const executor = live().commandExecutor!;
    const { cells } = live().gridState!;
    for (let at = 0; at < cells.length * cells[0]!.length; at++) {
      const depth = executor.historyDepth();
      executor.transaction({}, (tx) => {
        executor.execute(paintTerrainCommand([{ x: at % cells[0]!.length, y: Math.floor(at / cells[0]!.length) }], TerrainType.Mountain, 1));
        tx.commit();
      });
      if (executor.historyDepth() > depth) return;
    }
    throw new Error('no ground left to raise');
  };

  spec('UI-47', 'Next on a step that opens a mode moves to the step after it, never past it', async () => {
    shell();
    await showMe('shape');
    await standsAt('tour.show.mountain_open');
    nextStep();
    await standsAt('tour.show.mountain_paint');
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(callout().textContent).toContain(en('tour.show.mountain_paint'));
  });

  spec('UI-47', 'Back to the tips stands in each step\'s callout beside its Next, on a ringed step, a map step and one with no ring alike', async () => {
    shell();
    await showMe('objects');
    const backs = () => screen.getAllByRole('button', { name: en('tour.back_to_tips') });
    const inCallout = async (key: Parameters<typeof translateFor>[1]) => {
      await standsAt(key);
      expect(backs()).toHaveLength(1);
      const row = within(callout()).getByRole('button', { name: en('tour.back_to_tips') }).parentElement!;
      expect(within(row).getByRole('button', { name: /^(Next|Done)$/ })).toBeTruthy();
    };
    await inCallout('tour.show.objects_open');
    nextStep();
    await inCallout('tour.show.objects_card');
    nextStep();
    await inCallout('tour.show.objects_place');
    expect(tourCards(true).find((c) => c.kind === 'objects')!.show!.find((s) => s.id === 'place')).toMatchObject({ ring: [], map: true });
    await backToTips();
    await onCard('tour.objects_title');
  });

  spec('UI-47', 'Next on Save and share\'s first step moves to its tabs and keeps the Show me standing', async () => {
    shell();
    await showMe('share');
    await standsAt('tour.show.share_open');
    nextStep();
    await waitFor(() => expect(live().modals.share).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(live().tourPhase).toMatchObject({ kind: 'show', step: 1 });
    expect(screen.getByTestId('tour-callout')).toBeTruthy();
  });

  spec('UI-50', 'opening the tips from Settings while a Show me stands starts them over from the first card and gives back what it borrowed', async () => {
    shell();
    await showMe('shape');
    pressTarget('mode:mountain');
    await standsAt('tour.show.mountain_paint');
    act(() => startTour());
    expect(live().editMode.mode).toBeNull();
    expect(screen.queryByTestId('tour-callout')).toBeNull();
    await onCard('tour.welcome_title');
  });

  spec('UI-47', 'leaving a Show me never shows its card over the 3D view it borrowed', async () => {
    shell();
    await showMe('view3d');
    pressTarget('view3d');
    await waitFor(() => expect(live().viewMode).toBe('3d'));
    const seen: string[] = [];
    const off = useEditorStore.subscribe((s) => { if (s.tourPhase.kind === 'deck' && s.viewMode === '3d') seen.push('card over 3D'); });
    await backToTips();
    off();
    expect(seen).toEqual([]);
    expect(live().viewMode).toBe('2d');
  });

  spec('UI-47', 'a step done while a press is still down moves on only once it lets go', async () => {
    shell();
    await showMe('shape');
    await standsAt('tour.show.mountain_open');
    act(() => { fireEvent.pointerDown(window, { pointerId: 7, buttons: 1 }); });
    act(() => live().setEditMode({ mode: 'mountain' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(callout().textContent).toContain(en('tour.show.mountain_open'));
    act(() => { fireEvent.pointerUp(window, { pointerId: 7 }); });
    await standsAt('tour.show.mountain_paint');
  });

  spec('UI-47', 'a 3D step whose camera stands only after the visitor acts still counts their turn', async () => {
    let camera: CameraAngle | undefined;
    vi.spyOn(host.camera, 'get3d').mockImplementation(() => camera);
    shell();
    await showMe('view3d');
    pressTarget('view3d');
    await standsAt('tour.show.view3d_turn');
    // The hand acts while the scene is still building.
    act(() => { fireEvent.pointerDown(window, { pointerId: 3, buttons: 1 }); fireEvent.pointerUp(window, { pointerId: 3 }); });
    camera = { az: 0, el: 40, dist: 30 };
    act(() => live().eventBus.emit('viewport-changed', { zoom: 1 }));
    camera = { az: 40, el: 40, dist: 30 };
    act(() => live().eventBus.emit('viewport-changed', { zoom: 1 }));
    await standsAt('tour.show.view3d_tilt');
  });

  spec('UI-47', 'Generate\'s build step waits for the build to finish landing, and leaving cancels a build still landing', async () => {
    shell();
    await showMe('generate');
    pressTarget('mode:generate');
    await standsAt('tour.show.generate_kinds');
    nextStep();
    await standsAt('tour.show.generate_recipe');
    const cancel = vi.fn();
    let release = () => {};
    act(() => { release = holdEditInFlight(cancel, 'build'); raise(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(callout().textContent).toContain(en('tour.show.generate_recipe'));
    await backToTips();
    expect(cancel).toHaveBeenCalledTimes(1);
    act(() => release());
  });

  spec('UI-47', 'a map opened during a Show me keeps its own layer when the Show me ends', async () => {
    live().selectLayer(2);
    shell();
    await showMe('shape');
    await standsAt('tour.show.mountain_open');
    act(() => live().initMap(getMapTemplate(MAP_LIST.find((m) => m.id !== 'hexia')!.id), createDefaultRegistry()));
    await backToTips();
    expect([live().activeLayer, live().layerPinned]).toEqual([0, false]);
  });

  spec('UI-47', 'Notes cannot be opened while a Show me stands, so no note outlives it', async () => {
    shell();
    await showMe('shape');
    pressTarget('mode:mountain');
    await standsAt('tour.show.mountain_paint');
    act(() => live().setEditMode({ mode: 'annotate' }));
    expect(live().editMode.mode).toBe('mountain');
  });

  spec('UI-47', 'the layer panel\'s Notes row shows it cannot be opened while a Show me stands, and opens again once it ends', async () => {
    act(() => live().setAnnotationsVisible(false));
    shell();
    await showMe('shape');
    pressTarget('mode:mountain');
    await standsAt('tour.show.mountain_paint');
    act(() => fireEvent.click(screen.getByTestId('shell-layer-readout').parentElement!));
    const row = () => screen.getByRole('button', { name: en('annot.layer') });
    expect(row().getAttribute('aria-disabled')).toBe('true');
    act(() => fireEvent.click(row()));
    expect([live().editMode.mode, live().gridState!.annotations?.visible]).toEqual(['mountain', false]);
    await backToTips();
    expect(row().getAttribute('aria-disabled')).not.toBe('true');
  });

  spec('UI-47', 'the map and the view are saved only as a Show me found them, so a reload or a closed tab never keeps a try', async () => {
    const stop = installEditorSession({ frameFlashMs: 0 });
    const saved = () => { const restored = readAutosave(); return restored && mapFingerprint(restored.state); };
    try {
      shell();
      // An edit just made, its save still owed as the Show me begins.
      act(() => raise());
      const before = mapFingerprint(live().gridState!);
      await showMe('shape');
      pressTarget('mode:mountain');
      await standsAt('tour.show.mountain_paint');
      expect(saved()).toBe(before);
      act(() => { live().commandExecutor!.undo(); live().setViewMode('3d'); });
      expect(mapFingerprint(live().gridState!)).not.toBe(before);
      // The tab hidden, which may be the last moment it lives, then the page put away.
      act(() => autosave.flush());
      expect(saved()).toBe(before);
      act(() => { window.dispatchEvent(new Event('pagehide')); });
      expect(saved()).toBe(before);
      expect(readPref('viewMode')).toBe('2d');
      expect(live().tourPhase.kind).toBe('show');
      await backToTips();
      act(() => autosave.flush());
      expect(saved()).toBe(before);
      expect(readPref('viewMode')).toBe('2d');
    } finally {
      stop();
    }
  });

  spec('UI-47', 'gives back the material laid and the layer locks changed while trying', async () => {
    const roads = getRoadMaterials();
    live().setTileMaterial(roads[0]!.id);
    shell();
    await showMe('shape');
    pressTarget('mode:mountain');
    await standsAt('tour.show.mountain_paint');
    act(() => { live().setTileMaterial(roads[1]!.id); live().setLayerLocked(1, true); });
    await backToTips();
    expect(live().tileMaterial).toBe(roads[0]!.id);
    expect(live().gridState!.lockedLayers.has(1)).toBe(false);
  });

  spec('UI-47', 'a step whose control arrives late, while the page is still building, waits for it', async () => {
    shell();
    await showMe('objects');
    await standsAt('tour.show.objects_open');
    const cards = () => [...document.querySelectorAll<HTMLElement>(tourTargetSelector('shelf-card'))];
    // The shelf's cards are a while arriving, and the page keeps changing as they do.
    const late = new MutationObserver(() => { for (const card of cards()) card.removeAttribute('data-tour-target'); });
    late.observe(document.body, { childList: true, subtree: true });
    pressTarget('mode:object');
    const held = cards();
    for (const card of held) card.removeAttribute('data-tour-target');
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        document.body.append(document.createElement('i'));
        await new Promise((r) => setTimeout(r, 100));
      });
    }
    late.disconnect();
    expect(live().tourPhase).toMatchObject({ kind: 'show', step: 1 });
    for (const card of held) card.setAttribute('data-tour-target', 'shelf-card');
    await standsAt('tour.show.objects_card');
  });

  spec('UI-47', 'on a view fitted already, the Fit step counts Fit by its key as it counts the button', async () => {
    const fitted = { x: 10, y: 20, zoom: 0.8 };
    vi.spyOn(host.camera, 'get2d').mockReturnValue(fitted);
    vi.spyOn(host.camera, 'fitted2d').mockReturnValue(fitted);
    shell();
    await showMe('move');
    await standsAt('tour.show.move_pan');
    nextStep();
    await standsAt('tour.show.move_zoom');
    nextStep();
    await standsAt('tour.show.move_fit');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(callout().textContent).toContain(en('tour.show.move_fit'));
    act(() => { RUN['camera.fit']({ toggleMenu: () => {} }); });
    await waitFor(() => expect(live().tourPhase).toEqual({ kind: 'deck', card: tourCards(true).findIndex((c) => c.kind === 'move') }));
  });

  spec('UI-47', 'Escape during a try puts down what the map has armed first, then returns to the card', async () => {
    shell();
    await showMe('objects');
    pressTarget('mode:object');
    await standsAt('tour.show.objects_card');
    pressTarget('shelf-card');
    await standsAt('tour.show.objects_place');
    expect(live().editMode.arming.kind).toMatch(/item|macro/);
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    expect(live().editMode.arming.kind).not.toMatch(/item|macro/);
    expect(callout().textContent).toContain(en('tour.show.objects_place'));
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    await onCard('tour.objects_title');
  });
});
