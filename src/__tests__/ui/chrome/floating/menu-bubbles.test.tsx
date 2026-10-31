// @vitest-environment jsdom
import { TOUR_OFFERED } from '../../../_support/tour';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../../i18n/context';
import { MenuBubbles } from '../../../../ui/chrome/floating/MenuBubbles';
import { useKeybinds } from '../../../../state/keymap/store';
import { PREFS } from '../../../../platform/storage/prefs';
import { useEditorStore } from '../../../../state/store';
import { setStoreModal, setStoreState } from '../../../_support/store';
import { InputModeProvider } from '../../../../ui/design/input-mode';
import type { InputMode } from '../../../../platform/device/input-mode';
import type { LayoutShape } from '../../../../platform/device/layout-shape';
import { __resetArrivals, setArrivalStanding } from '../../../../ui/session/arrival-bus';

/** The task the bubbles wait through before they look. */
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { configurable: true, value });
}

/** The input mode the next render's app root provides. */
let inputMode: InputMode = 'pc';
/** The layout shape the next render's app root provides. */
let shape: LayoutShape = 'landscape';

/** Touch mode in a browser that has fullscreen, with the screen released to the bubbles. */
function poseMobile(request = vi.fn().mockResolvedValue(undefined)) {
  inputMode = 'touch';
  define(document, 'fullscreenEnabled', true);
  define(document.documentElement, 'requestFullscreen', request);
  define(document, 'fullscreenElement', null);
  return request;
}

function renderBubbles(splashActive = false) {
  return render(
    <MotionConfig reducedMotion="always">
      <InputModeProvider inputMode={inputMode} shape={shape}>
        <I18nProvider>
          <div data-tour-target="menu" ref={(el) => { if (el) el.getBoundingClientRect = () => ({ left: 700, top: 20, width: 40, height: 40, right: 740, bottom: 60, x: 700, y: 20, toJSON: () => ({}) }) as DOMRect; }} />
          <MenuBubbles splashActive={splashActive} />
        </I18nProvider>
      </InputModeProvider>
    </MotionConfig>,
  );
}

const IMMERSIVE = /Immersive mode is recommended on mobile devices/;
const HELP = /explanation/;

beforeEach(() => {
  inputMode = 'pc';
  shape = 'landscape';
  __resetArrivals();
  setStoreState({ locale: 'en', tourRunning: false, modals: { ...useEditorStore.getState().modals, help: false } });
  useKeybinds.getState().resetAll();
  localStorage.clear();
  localStorage.setItem(PREFS.tourSeen.key, TOUR_OFFERED);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) delete (document as unknown as Record<string, unknown>)[key];
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
});

describe('MenuBubbles', () => {
  it('on an upright window waits while the arrival notice stands, which spans the band it points into', async () => {
    poseMobile();
    shape = 'portrait';
    act(() => setArrivalStanding(true));
    renderBubbles();
    await tick();
    expect(screen.queryByTestId('speech-bubble')).toBeNull();
    act(() => setArrivalStanding(false));
    await tick();
    expect(screen.getByRole('button', { name: IMMERSIVE })).toBeTruthy();
  });

  it('in touch mode waits for a standing arrival notice in the landscape shape too, both drawn a fingertip tall', async () => {
    poseMobile();
    act(() => setArrivalStanding(true));
    renderBubbles();
    await tick();
    expect(screen.queryByTestId('speech-bubble')).toBeNull();
    act(() => setArrivalStanding(false));
    await tick();
    expect(screen.getByRole('button', { name: IMMERSIVE })).toBeTruthy();
  });

  it('invites a touch device into immersive mode and enters on a tap', async () => {
    const request = poseMobile();
    renderBubbles();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: IMMERSIVE }));
    expect(request).toHaveBeenCalledTimes(1);
    define(document, 'fullscreenElement', document.documentElement);
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    await waitFor(() => expect(screen.queryByTestId('speech-bubble')).toBeNull());
  });

  it('stays away in PC mode with nothing to say', async () => {
    poseMobile();
    inputMode = 'pc';
    renderBubbles();
    await tick();
    expect(screen.queryByTestId('speech-bubble')).toBeNull();
  });

  it('speaks one task after the release, so a window opening in the same moment goes first', async () => {
    poseMobile();
    renderBubbles();
    expect(screen.queryByTestId('speech-bubble')).toBeNull();
    act(() => { setStoreModal('whatsNew', true); });
    await tick();
    expect(screen.queryByTestId('speech-bubble')).toBeNull();
    act(() => { setStoreModal('whatsNew', false); });
    await tick();
    expect(screen.getByRole('button', { name: IMMERSIVE })).toBeTruthy();
  });

  it('waits while the tour runs or the splash covers the app', async () => {
    poseMobile();
    setStoreState({ tourRunning: true });
    const view = renderBubbles();
    await tick();
    expect(screen.queryByTestId('speech-bubble')).toBeNull();
    view.unmount();
    setStoreState({ tourRunning: false });
    renderBubbles(true);
    await tick();
    expect(screen.queryByTestId('speech-bubble')).toBeNull();
  });

  it('points at Help once the tour ends, on any device, and opens it on a tap', async () => {
    setStoreState({ tourRunning: true });
    renderBubbles();
    act(() => { setStoreState({ tourRunning: false }); });
    fireEvent.click(await screen.findByRole('button', { name: HELP }));
    expect(useEditorStore.getState().modals.help).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('speech-bubble')).toBeNull());
  });

  it('follows the help hint with the immersive invitation on a touch device', async () => {
    poseMobile();
    setStoreState({ tourRunning: true });
    renderBubbles();
    act(() => { setStoreState({ tourRunning: false }); });
    expect(await screen.findByRole('button', { name: HELP })).toBeTruthy();
    expect(screen.queryByRole('button', { name: IMMERSIVE })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('button', { name: IMMERSIVE })).toBeTruthy();
  });
});

it.each([['shift+h', /Shift.*H/], ['ctrl+alt+h', /Ctrl.*Alt.*H/]])('shows the active context-help shortcut after the tour (%s)', async (combo, label) => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  useKeybinds.getState().rebind('app.whats_this', combo);
  setStoreState({ tourRunning: true });
  renderBubbles();
  act(() => { setStoreState({ tourRunning: false }); });
  expect(await screen.findByRole('button', { name: label })).toBeTruthy();
});

it('gives a menu route when context help is unbound', async () => {
  useKeybinds.getState().clear('app.whats_this');
  setStoreState({ tourRunning: true });
  renderBubbles();
  act(() => { setStoreState({ tourRunning: false }); });
  expect(await screen.findByRole('button', { name: /Choose.*What's this.*in Help/ })).toBeTruthy();
});
