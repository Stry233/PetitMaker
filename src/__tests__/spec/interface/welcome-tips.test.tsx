// @vitest-environment jsdom
/**
 * The welcome tips through their rendered window and the store's public actions: when they open,
 * how the cards turn, what each card says in each input mode, the summary, the reels, and Show me
 * on the live shell. How the window looks and moves is checked in the browser journey.
 */
import { describe, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { translateFor } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import type { InputMode } from '../../../platform/device/input-mode';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import { __resetGlProbe } from '../../../platform/device/device-quality';
import { useEditorStore } from '../../../state/store';
import { readPref, writePref } from '../../../platform/storage/prefs';
import { Shell } from '../../../ui/shell/Shell';
import { Tour } from '../../../ui/chrome/tour/Tour';
import { TOUR_KINDS, tourCards } from '../../../ui/chrome/tour/deck';
import { TOUR_VERSION } from '../../../ui/chrome/tour/version';
import { __setReelFiles, playedReel, reelFiles, REEL_TYPES } from '../../../ui/chrome/tour/reels';
import { REEL_FILES } from '../../../ui/chrome/tour/reel-files';
import { LOCALES } from '../../../core/model/locale';
import { startTour, tourWarmFiles, useFirstLaunchTour } from '../../../ui/chrome/tour/use-tour';
import { WhatsNewGate } from '../../../ui/chrome/modals/whats-new/WhatsNewGate';
import { TourPreview } from '../../../ui/help/figures/previews/tour';
import type { MapAnnotation } from '../../../core/model/annotations';
import { TerrainType } from '../../../core/model/types';
import { paintTerrainCommand } from '../../../core/model/command-build';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { getMapTemplate, MAP_LIST } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { tourTargetSelector, type TourTargetId } from '../../../ui/chrome/tour/steps';
import { setStoreModal, setStoreState } from '../../_support/store';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { spec } from '../../_support/spec';
import type { HandoffStage } from '../../../ui/session/splash-handoff';
import { EditorRoot } from '../../../ui/app/EditorRoot';
import { NO_DOCK } from '../../../ui/design/scale';
import type { TourWatch } from '../../../ui/session/tour-watch';
import { holdEditInFlight } from '../../../state/edits-in-flight';
import { getRoadMaterials } from '../../../state/catalog';
import { autosave } from '../../../editor/session/autosave';
import { installEditorSession } from '../../../editor/session/install';
import { readAutosave } from '../../../io/storage/autosave';

const en = (key: Parameters<typeof translateFor>[1], params?: Record<string, string | number>) => translateFor('en', key, params as never);

/** A device whose canvas does or does not give a WebGL2 context, as the browser answers. */
function deviceWithWebGL2(has: boolean): void {
  const gl = { getExtension: () => null, getParameter: () => 1 };
  HTMLCanvasElement.prototype.getContext = ((kind: string) => (has && (kind === 'webgl2' || kind === 'webgl') ? gl : null)) as never;
  __resetGlProbe();
}

function mountTips(inputMode: InputMode = 'pc', reduced = true, shape: LayoutShape = 'landscape') {
  return render(
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <I18nProvider><InputModeProvider inputMode={inputMode} shape={shape}><Tour /></InputModeProvider></I18nProvider>
    </MotionConfig>,
  );
}

const deck = () => screen.getByTestId('tour-deck');
/** The outgoing card stays for its fade; these wait until one card stands. */
const settled = () => waitFor(() => expect(within(deck()).getAllByRole('heading')).toHaveLength(1));
const title = () => within(deck()).getByRole('heading').textContent;
const press = async (name: string) => { await settled(); fireEvent.click(within(deck()).getByRole('button', { name })); };
const onCard = async (key: Parameters<typeof translateFor>[1]) => { await settled(); expect(title()).toBe(en(key)); };
const dot = (n: number) => en('tour.dot', { n, total: tourCards(true).length });
/** Back to the tips, pressed in the callout of the Show me step standing, once it shows. */
const backToTips = async () => {
  const callout = await screen.findByTestId('tour-callout', undefined, { timeout: 4000 });
  act(() => fireEvent.click(within(callout).getByRole('button', { name: en('tour.back_to_tips') })));
};

const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  localStorage.clear();
  deviceWithWebGL2(true);
  setStoreState({ locale: 'en', tourRunning: false });
  useEditorStore.getState().setEditMode({ mode: null });
  useEditorStore.getState().setViewMode('2d');
});
afterEach(() => {
  cleanup();
  act(() => { useEditorStore.getState().finishTour(); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  __resetGlProbe();
});

describe('when the welcome tips open', () => {
  spec('UI-50', 'a first visit opens them on the welcome card and records this version as offered', async () => {
    renderHook(() => useFirstLaunchTour(false));
    mountTips();
    expect(useEditorStore.getState().tourRunning).toBe(true);
    await onCard('tour.welcome_title');
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe(String(TOUR_VERSION));
  });

  spec('UI-50', 'a browser offered the older tour sees them once even holding a saved map; one with a map from before any tips is only recorded', async () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    renderHook(() => useFirstLaunchTour(true));
    expect(useEditorStore.getState().tourRunning).toBe(true);
    act(() => { useEditorStore.getState().finishTour(); });
    cleanup();
    renderHook(() => useFirstLaunchTour(true));
    expect(useEditorStore.getState().tourRunning).toBe(false);
    cleanup();
    localStorage.clear();
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
    await press(dot(tourCards(true).length));
    await press(en('tour.next'));
    act(() => fireEvent.click(screen.getByRole('button', { name: en('tour.start') })));
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe(String(TOUR_VERSION));
  });

  spec('UI-51', 'a visit that opens the newer tips says nothing of What\'s new, whichever of the two looks first', async () => {
    for (const whatsNewFirst of [true, false]) {
      localStorage.clear();
      localStorage.setItem(TOUR_SEEN_KEY, '1');
      writePref('lastSeenVersion', '0.0.1');
      setStoreModal('whatsNew', false);
      if (whatsNewFirst) render(<WhatsNewGate splashActive={false} />);
      renderHook(() => useFirstLaunchTour(true));
      if (!whatsNewFirst) render(<WhatsNewGate splashActive={false} />);
      act(() => { useEditorStore.getState().finishTour(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(useEditorStore.getState().modals.whatsNew).toBe(false);
      expect(readPref('lastSeenVersion')).toBe('0.0.1');
      cleanup();
    }
  });

  spec('UI-38', 'a pictured shell, as Help draws it, never opens the tips, even for a browser offered the older tour', () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    render(<MotionConfig reducedMotion="always"><I18nProvider><TourPreview /></I18nProvider></MotionConfig>);
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });
});

describe('the cards', () => {
  spec('UI-45', 'Next walks the cards, a dot goes to its card and Back steps back', async () => {
    startTour();
    mountTips();
    await press(en('tour.next'));
    await onCard('tour.move_title');
    await press(dot(4));
    await onCard('tour.objects_title');
    await press(en('tour.back'));
    await onCard('tour.shape_title');
  });

  spec('UI-45', 'a wide card holds one heading, its own title, and one Skip, which closes the tips', async () => {
    setStoreState({ layoutShape: 'landscape' });
    startTour();
    mountTips();
    await settled();
    expect([...deck().querySelectorAll('h1, h2, h3')].map((h) => h.textContent)).toEqual([en('tour.welcome_title')]);
    const skips = within(deck()).getAllByRole('button', { name: en('tour.skip') });
    expect(skips).toHaveLength(1);
    fireEvent.click(skips[0]!);
    expect(useEditorStore.getState().tourRunning).toBe(false);
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
    expect(tourCards(false).map((c) => c.kind)).not.toContain('view3d');
    expect(tourCards(true).map((c) => c.kind)).toContain('view3d');
    for (const webgl2 of [true, false]) {
      deviceWithWebGL2(webgl2);
      startTour();
      mountTips();
      const total = tourCards(webgl2).length;
      expect(within(deck()).getByRole('button', { name: en('tour.dot', { n: total, total }) })).toBeTruthy();
      cleanup();
      act(() => { useEditorStore.getState().finishTour(); });
    }
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

  spec('UI-48', 'the summary shows a tile per card it covers, each returning to its card, and the way on takes focus', async () => {
    startTour();
    mountTips();
    const cards = tourCards(true);
    await press(dot(cards.length));
    await press(en('tour.next'));
    expect(screen.getByTestId('tour-recap').textContent).toContain(en('tour.recap_body'));
    await waitFor(() => expect(document.activeElement?.textContent).toBe(en('tour.start')));
    const tiles = cards.filter((c) => c.tileKey);
    expect(tiles.map((c) => c.kind)).not.toContain('welcome');
    for (const card of tiles) expect(screen.getByRole('button', { name: en('tour.recap_tile', { tip: en(card.tileKey!) }) })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en('tour.recap_tile', { tip: en('tour.shape_tile') }) }));
    await onCard('tour.shape_title');
    expect(document.activeElement?.textContent).toBe(en('tour.next'));
  });

  spec('UI-53', 'under reduced motion the summary drops no confetti', async () => {
    startTour();
    mountTips();
    await press(dot(tourCards(true).length));
    await press(en('tour.next'));
    expect(screen.getByTestId('tour-recap')).toBeTruthy();
    expect(screen.queryByTestId('tour-confetti')).toBeNull();
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
  /** Drags a finger from the first point through the rest, `ms` apart, on the card's words. */
  const drag = (points: readonly [number, number][], { ms = 16, pointerType = 'touch' } = {}) => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const on = within(deck()).getByRole('heading');
    const at = (x: number, y: number) => ({ pointerId: 1, isPrimary: true, pointerType, clientX: x, clientY: y });
    act(() => { fireEvent.pointerDown(on, at(...points[0]!)); });
    for (const [x, y] of points.slice(1)) {
      now += ms;
      act(() => { fireEvent.pointerMove(on, at(x, y)); });
    }
    now += ms;
    act(() => { fireEvent.pointerUp(on, at(...points.at(-1)!)); });
    clock.mockRestore();
  };
  const cards = tourCards(true);
  /** A slow drag along x from 300 by `to`, in 10 px steps a frame apart. */
  const slow = (to: number) => Array.from({ length: Math.abs(to) / 10 + 1 }, (_, i) => [300 + Math.sign(to) * i * 10, 400] as [number, number]);

  spec('UI-56', 'in touch mode a swipe to the left turns to the next card and one to the right back, and the last card\'s reaches the summary', async () => {
    startTour();
    mountTips('touch');
    await onCard(cards[0]!.titleKey);
    drag(slow(160));
    await settled();
    expect(title(), 'nothing before the first card').toBe(en(cards[0]!.titleKey));
    drag(slow(-140));
    await onCard(cards[1]!.titleKey);
    drag(slow(140));
    await onCard(cards[0]!.titleKey);
    drag([[300, 400], [290, 400], [270, 400]], { ms: 16 });
    await onCard(cards[1]!.titleKey);
    await press(dot(cards.length));
    await onCard(cards.at(-1)!.titleKey);
    drag(slow(-140));
    await waitFor(() => expect(screen.getByTestId('tour-recap')).toBeTruthy());
  });

  spec('UI-56', 'a short slow swipe, a drag that sets off vertically and a mouse drag leave the card where it is', async () => {
    startTour();
    mountTips('touch');
    await onCard(cards[0]!.titleKey);
    drag(slow(-30), { ms: 120 });
    await settled();
    expect(title(), 'too short and slow to turn').toBe(en(cards[0]!.titleKey));
    drag([[300, 400], [301, 390], [302, 380], [250, 380], [150, 380]]);
    await settled();
    expect(title(), 'the words\' scroll').toBe(en(cards[0]!.titleKey));
    cleanup();
    mountTips('pc');
    await onCard(cards[0]!.titleKey);
    drag(slow(-160), { pointerType: 'mouse' });
    await settled();
    expect(title(), 'a mouse drag').toBe(en(cards[0]!.titleKey));
  });
});

describe('an enlarged reel', () => {
  spec('UI-55', 'a press enlarges the reel out of the card and another puts it back, the same clip at the same time; Escape puts it back before closing the tips', async () => {
    startTour();
    mountTips();
    const toggle = () => screen.getByTestId('tour-reel-enlarge');
    const video = () => screen.getByTestId('tour-reel-clip-video') as HTMLVideoElement;
    const clip = video();
    let time = 4.2;
    Object.defineProperty(clip, 'currentTime', { configurable: true, get: () => time, set: (v: number) => { time = v; } });
    expect(toggle().getAttribute('aria-label')).toBe(en('tour.reel_enlarge'));
    act(() => fireEvent.click(toggle()));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe(en('tour.reel_restore'));
    expect(deck().contains(video()), 'out of the card').toBe(false);
    expect(title(), 'the card stays').toBe(en('tour.welcome_title'));
    expect([video(), video().currentTime]).toEqual([clip, 4.2]);
    act(() => fireEvent.click(toggle()));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(deck().contains(video()), 'back in the card').toBe(true);
    expect([video(), video().currentTime]).toEqual([clip, 4.2]);
    expect(document.activeElement, 'focus back on the reel').toBe(toggle());
    act(() => fireEvent.click(toggle()));
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('tour-deck')).toBeTruthy();
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByTestId('tour-deck')).toBeNull());
  });
});

describe('the reels', () => {
  const sources = () => [...screen.getByTestId('tour-reel-clip-video').querySelectorAll('source')].map((el) => el.getAttribute('src'));

  spec('UI-49', 'every locale ships its own reel, poster and timing for every card in every form, and a locale without them plays the English ones', () => {
    const forms = ['mouse-land', 'mouse-tall', 'touch-tall', 'touch-land'] as const;
    const missing = LOCALES.flatMap((locale) => forms.flatMap((form) => TOUR_KINDS.flatMap((kind) =>
      ['webm', 'mp4', 'jpg'].map((ext) => `${locale}/${form}/${kind}.${ext}`).concat(`${locale}/${form}/reels.json`)
        .filter((path) => !REEL_FILES[path]))));
    expect([...new Set(missing)]).toEqual([]);
    // Every shipped locale has its own set, so the fallback is shown with a table that lacks Thai.
    __setReelFiles(Object.fromEntries(Object.entries(REEL_FILES).filter(([path]) => !path.startsWith('th/'))));
    try {
      const english = reelFiles('en', 'touch-tall', 'welcome');
      expect(english?.poster).toBeTruthy();
      expect(reelFiles('th', 'touch-tall', 'welcome')).toEqual(english);
    } finally { __setReelFiles(null); }
  });

  spec('UI-49', 'a card plays the recording of the reader\'s locale and form', async () => {
    for (const [locale, inputMode, shape, form] of [['en', 'pc', 'landscape', 'mouse-land'], ['zh', 'touch', 'portrait', 'touch-tall']] as const) {
      setStoreState({ locale });
      startTour();
      mountTips(inputMode, true, shape);
      expect(sources()).toContain(playedReel(reelFiles(locale, form, 'welcome')!));
      cleanup();
      act(() => { useEditorStore.getState().finishTour(); });
    }
  });

  spec('UI-49', 'under reduced motion a reel rests on its poster with a play button; otherwise it plays on its own and shows no picture of its end while it loads', async () => {
    startTour();
    mountTips('pc', true);
    const video = () => screen.getByTestId('tour-reel-clip-video') as HTMLVideoElement;
    expect(video().autoplay).toBe(false);
    expect(video().getAttribute('poster')).toBeTruthy();
    expect(screen.getByTestId('tour-reel-clip-play')).toBeTruthy();
    cleanup();
    mountTips('pc', false);
    expect(video().autoplay).toBe(true);
    expect(video().getAttribute('poster')).toBeNull();
  });

  spec('UI-49', 'a reel still loading shows the loading dots, and they leave once it plays or stall again with it', async () => {
    startTour();
    mountTips('pc', false);
    const dots = () => screen.queryByTestId('tour-reel-clip-loading');
    expect(dots()).toBeNull();
    await waitFor(() => expect(dots()).not.toBeNull());
    const video = screen.getByTestId('tour-reel-clip-video');
    fireEvent(video, new Event('playing'));
    expect(dots()).toBeNull();
    fireEvent(video, new Event('waiting'));
    await waitFor(() => expect(dots()).not.toBeNull());
  });

  spec('UI-49', 'a reel that cannot load shows its poster and the card still works', async () => {
    startTour();
    mountTips();
    const offered = screen.getByTestId('tour-reel-clip-video').querySelectorAll('source');
    fireEvent.error(offered[offered.length - 1]!);
    expect(screen.getByTestId('tour-reel-clip-poster')).toBeTruthy();
    await press(en('tour.next'));
    await onCard('tour.move_title');
  });

  spec('UI-49', 'an engine without AV1 plays the H.264 copy', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) => (type.startsWith('video/mp4') ? 'probably' : ''));
    const files = reelFiles('en', 'mouse-land', 'welcome')!;
    startTour();
    mountTips();
    const offered = [...screen.getByTestId('tour-reel-clip-video').querySelectorAll('source')].map((el) => [el.getAttribute('src'), el.getAttribute('type')]);
    expect(offered).toContainEqual([files.mp4, REEL_TYPES.mp4]);
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
      Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
    }
  });

  spec('UI-52', 'the loading screen fetches the opening reel only on a visit that opens the tips, also once the first-launch check has recorded the offer', async () => {
    const files = reelFiles('en', 'mouse-land', 'welcome')!;
    setStoreState({ inputMode: 'pc', layoutShape: 'landscape' });
    expect(tourWarmFiles()).toEqual(expect.arrayContaining([files.poster]));
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    expect(tourWarmFiles()).toEqual([]);
    localStorage.removeItem(TOUR_SEEN_KEY);
    renderHook(() => useFirstLaunchTour(false));
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe(String(TOUR_VERSION));
    expect(tourWarmFiles()).toEqual(expect.arrayContaining([files.poster]));
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
    expect(screen.queryByTestId('tour-reel-clip-play'), 'no play button').toBeNull();
    rerender(view('leaving'));
    expect(played).toEqual([0]);
    rerender(view('none'));
    expect(played).toEqual([0]);
  });
});

describe('how a Show me step knows it is done', () => {
  const stepOf = (kind: string, id: string) => tourCards(true).find((c) => c.kind === kind)!.show!.find((s) => s.id === id)!;
  const flat = (camera: { x: number; y: number; zoom: number }, fit = { x: 0, y: 0, zoom: 1 }): TourWatch => ({
    view: '2d', mode: null, arming: 'none', layer: 0, share: false, edits: 0, building: false, camera2d: camera, fit2d: fit, camera3d: null,
  });
  const untried = { fit: false };

  spec('UI-47', 'the pan step counts a move across the map, never a zoom; the Fit step counts the camera landing fitted, or Fit itself on a view fitted already', () => {
    const pan = stepOf('move', 'pan');
    /** Whether the step counts a run of camera readings, each one taken as the map moves. */
    const counts = (readings: TourWatch[]): boolean => {
      let from = readings[0]!;
      for (let i = 1; i < readings.length; i++) {
        if (pan.rebase?.(readings[i - 1]!, readings[i]!)) from = readings[i]!;
        if (pan.done!(from, readings[i]!, untried)) return true;
      }
      return false;
    };
    /** The camera a zoom by `k` about screen point (qx, qy) of a camera at offset 0 and zoom 1 lands on. */
    const zoomedAbout = (k: number, qx: number, qy: number) => flat({ x: qx * (k - 1), y: qy * (k - 1), zoom: k });
    const rest = flat({ x: 0, y: 0, zoom: 1 });
    expect(counts([rest, zoomedAbout(1.1, 760, 40), zoomedAbout(1.21, 760, 40), zoomedAbout(1.331, 760, 40)])).toBe(false);
    expect(counts([rest, zoomedAbout(2.1, 400, 300)])).toBe(false);
    expect(counts([rest, flat({ x: 60, y: 0, zoom: 1 })])).toBe(true);
    // A drag after the zoom counts from where the zoom left the map.
    const zoomed = zoomedAbout(1.331, 760, 40);
    expect(counts([rest, zoomed, flat({ x: zoomed.camera2d!.x - 30, y: zoomed.camera2d!.y, zoom: 1.331 })])).toBe(false);
    expect(counts([rest, zoomed, flat({ x: zoomed.camera2d!.x - 60, y: zoomed.camera2d!.y, zoom: 1.331 })])).toBe(true);

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

describe('Show me on the card', () => {
  spec('UI-47', 'the assistant card has no Show me; every other card after the welcome has one', async () => {
    const cards = tourCards(true);
    for (const card of cards.filter((c) => c.kind !== 'welcome' && c.kind !== 'assistant')) expect(card.show?.length, card.kind).toBeGreaterThan(0);
    startTour();
    mountTips();
    await press(dot(cards.findIndex((c) => c.kind === 'assistant') + 1));
    await onCard('tour.assistant_title');
    expect(screen.queryByTestId('tour-show-me')).toBeNull();
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
    expect(useEditorStore.getState().tourPhase.kind).toBe('deck');
    act(() => release());
    expect(screen.getByTestId('tour-show-me').getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(screen.getByTestId('tour-show-me'));
    expect(useEditorStore.getState().tourPhase.kind).toBe('show');
  });
});

describe('Show me on the live shell', () => {
  beforeEach(() => {
    localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
    // jsdom lays nothing out; a ringed control needs a size for its step to stand.
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
    await press(dot(tourCards(true).findIndex((c) => c.kind === kind) + 1));
    act(() => fireEvent.click(screen.getByTestId('tour-show-me')));
  };
  const callout = () => screen.getByTestId('tour-callout');
  const standsAt = (key: Parameters<typeof translateFor>[1]) => waitFor(() => expect(callout().textContent).toContain(en(key)));
  /** The live control a step rings, pressed as the visitor would. */
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

  spec('UI-47', 'a step waits for the visitor to press the real control, moves on once they have, and gives back the mode it borrowed', async () => {
    shell();
    await showMe('shape');
    await standsAt('tour.show.mountain_open');
    expect(live().editMode.mode).toBeNull();
    pressTarget('mode:mountain');
    expect(live().editMode.mode).toBe('mountain');
    await standsAt('tour.show.mountain_paint');
    await backToTips();
    expect(live().editMode.mode).toBeNull();
    await onCard('tour.shape_title');
  });

  spec('UI-47', 'Next on a step that opens a mode moves to the step after it, never past it', async () => {
    shell();
    await showMe('shape');
    await standsAt('tour.show.mountain_open');
    nextStep();
    await standsAt('tour.show.mountain_paint');
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(callout().textContent).toContain(en('tour.show.mountain_paint'));
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

  spec('UI-47', 'the 3D card\'s Show me moves on as the view switches, and leaving returns the view to 2D before the card shows', async () => {
    shell();
    await showMe('view3d');
    await standsAt('tour.show.view3d_switch');
    pressTarget('view3d');
    await waitFor(() => expect(live().viewMode).toBe('3d'));
    await standsAt('tour.show.view3d_turn');
    const seen: string[] = [];
    const off = useEditorStore.subscribe((s) => { if (s.tourPhase.kind === 'deck' && s.viewMode === '3d') seen.push('card over 3D'); });
    await backToTips();
    off();
    expect(seen).toEqual([]);
    expect(live().viewMode).toBe('2d');
  });

  spec('UI-47', 'in touch mode the 3D card leaves out the tilt, which no finger gesture makes', async () => {
    const steps = tourCards(true).find((c) => c.kind === 'view3d')!.show!;
    shell('touch');
    await showMe('view3d');
    pressTarget('view3d');
    await standsAt('tour.show.view3d_turn_touch');
    const offered = steps.filter((step) => step.input !== 'pc').length;
    expect(offered).toBeLessThan(steps.length);
    expect(callout().textContent).toContain(en('tour.progress', { n: 2, total: offered }));
  });

  spec('UI-47', 'what the visitor builds while trying comes off again, with the history, the material and the layer locks as they stood', async () => {
    const roads = getRoadMaterials();
    live().setTileMaterial(roads[0]!.id);
    shell();
    raise();
    raise();
    const built = mapFingerprint(live().gridState!);
    act(() => { live().commandExecutor!.undo(); });
    const before = mapFingerprint(live().gridState!);
    const depth = live().commandExecutor!.historyDepth();
    await showMe('shape');
    pressTarget('mode:mountain');
    await standsAt('tour.show.mountain_paint');
    act(() => raise());
    await standsAt('tour.show.mountain_erase');
    // Undone past where Show me began, then built on: the history parted from the one it found.
    act(() => { live().commandExecutor!.undo(); live().commandExecutor!.undo(); raise(); });
    act(() => { live().setTileMaterial(roads[1]!.id); live().setLayerLocked(1, true); });
    expect(mapFingerprint(live().gridState!)).not.toBe(before);
    await backToTips();
    expect(mapFingerprint(live().gridState!)).toBe(before);
    expect(live().commandExecutor!.historyDepth()).toBe(depth);
    expect(live().tileMaterial).toBe(roads[0]!.id);
    expect(live().gridState!.lockedLayers.has(1)).toBe(false);
    act(() => { live().commandExecutor!.redo(); });
    expect(mapFingerprint(live().gridState!)).toBe(built);
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
      await backToTips();
      act(() => autosave.flush());
      expect(saved()).toBe(before);
      expect(readPref('viewMode')).toBe('2d');
    } finally {
      stop();
    }
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

  spec('UI-47', 'the layer panel\'s Notes row cannot be opened while a Show me stands, and opens again once it ends', async () => {
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

  spec('UI-47', 'Escape over the Save and share window it opened returns to the card and closes the window', async () => {
    shell();
    await showMe('share');
    await standsAt('tour.show.share_open');
    pressTarget('share');
    await waitFor(() => expect(live().modals.share).toBe(true));
    await standsAt('share.tab_keep');
    await waitFor(() => expect(callout().contains(document.activeElement)).toBe(true));
    act(() => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    await onCard('tour.share_title');
    expect(live().modals.share).toBe(false);
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
});
