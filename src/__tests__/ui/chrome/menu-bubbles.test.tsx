import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { MenuBubbles } from '../../../ui/chrome/floating/MenuBubbles';
import { useKeybinds } from '../../../core/runtime/keybindings';
import { PREFS } from '../../../core/runtime/prefs';
import { useEditorStore } from '../../../state/store';
import { setStoreModal, setStoreState } from '../../_store';

/** The task the bubbles wait through before they look. */
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { configurable: true, value });
}

/** A touch device whose browser has fullscreen, with the screen released to the bubbles. */
function poseMobile(request = vi.fn().mockResolvedValue(undefined)) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {} }));
  define(document, 'fullscreenEnabled', true);
  define(document.documentElement, 'requestFullscreen', request);
  define(document, 'fullscreenElement', null);
  return request;
}

function renderBubbles(splashActive = false) {
  return render(
    <MotionConfig reducedMotion="always">
      <I18nProvider>
        <div data-tour-target="menu" ref={(el) => { if (el) el.getBoundingClientRect = () => ({ left: 700, top: 20, width: 40, height: 40, right: 740, bottom: 60, x: 700, y: 20, toJSON: () => ({}) }) as DOMRect; }} />
        <MenuBubbles splashActive={splashActive} />
      </I18nProvider>
    </MotionConfig>,
  );
}

const IMMERSIVE = /Immersive mode is recommended on mobile devices/;
const HELP = /explanation/;

beforeEach(() => {
  setStoreState({ locale: 'en', portraitBlocked: false, tourRunning: false, modals: { ...useEditorStore.getState().modals, tourDone: false, help: false } });
  useKeybinds.getState().resetAll();
  localStorage.clear();
  localStorage.setItem(PREFS.tourSeen.key, '1');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) delete (document as unknown as Record<string, unknown>)[key];
  delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen;
});

describe('MenuBubbles', () => {
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

  it('stays away on a pointer device with nothing to say', async () => {
    poseMobile();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
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
  expect(await screen.findByRole('button', { name: /Choose.*What’s this.*in Help/ })).toBeTruthy();
});
