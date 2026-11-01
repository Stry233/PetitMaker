// @vitest-environment jsdom
/**
 * Help read by the device: the touch gestures have their own Help section, copy that
 * names a mouse button, the wheel or hovering reads as finger copy in touch mode, and copy that
 * places the modes at the top left reads as the bottom bar on an upright screen.
 */
import { MotionConfig } from 'framer-motion';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { I18nProvider, translateFor } from '../../../i18n/context';
import { HelpModal } from '../../../ui/help/HelpModal';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { makeState } from '../../_support/map-state';
import { setStoreState } from '../../_support/store';
import type { InputMode } from '../../../platform/device/input-mode';
import type { LayoutShape } from '../../../platform/device/layout-shape';
import type { HelpPageId } from '../../../ui/help/page-schema';
import type { TextKey } from '../../../i18n/keys';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';

beforeEach(() => {
  setStoreState({ gridState: makeState(20, 20), locale: 'en' });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const en = (key: TextKey): string => translateFor('en', key);

/** Help opened at `page`, as a reader in `inputMode` on a `shape` screen sees it. */
async function helpAt(page: HelpPageId, inputMode: InputMode, shape: LayoutShape = 'landscape'): Promise<HTMLElement> {
  setStoreState({ helpTarget: { page } });
  const { baseElement } = render(
    <MotionConfig reducedMotion="always"><I18nProvider>
      <InputModeProvider inputMode={inputMode} shape={shape}><HelpModal open onClose={() => {}} /></InputModeProvider>
    </I18nProvider></MotionConfig>,
  );
  await waitFor(() => expect(baseElement.querySelector('h2')).toBeTruthy());
  return baseElement;
}

/** The stacking rung of the surface directly under `root` that holds `el`. */
function rungIn(root: Element, el: Element): number {
  let top = el;
  while (top.parentElement && top.parentElement !== root) top = top.parentElement;
  return Number(getComputedStyle(top).zIndex);
}

/** The plain text a Help string shows: its bold marks and inline art drop out. */
const shown = (key: TextKey): string => en(key).replace(/\*\*/g, '').replace(/\[\[[a-z0-9-]+\]\]\s?/g, '');

describe('Help in touch mode', () => {
  spec('UI-33', 'Help lists the touch gestures', async () => {
    const help = await helpAt('touch', 'pc');
    await waitFor(() => expect(help.querySelector('#help-touch-gestures')).toBeTruthy());
    const text = help.textContent ?? '';
    for (const key of ['help.camera.g_tap', 'help.camera.g_double', 'help.camera.g_hold', 'help.camera.g_multi', 'help.camera.g_shelf', 'help.camera.g_loupe', 'help.camera.g_undo'] as const) {
      expect(text, key).toContain(shown(key).slice(0, 40));
    }
  });

  spec('UI-33', 'the object menu is described as a long press in touch mode and as a right-click with a mouse', async () => {
    const touch = await helpAt('select', 'touch');
    await waitFor(() => expect(touch.textContent).toContain(en('help.select.menu_t_touch')));
    expect(touch.textContent).not.toContain(en('help.select.menu_t'));
    cleanup();
    const mouse = await helpAt('select', 'pc');
    await waitFor(() => expect(mouse.textContent).toContain(en('help.select.menu_t')));
    expect(mouse.textContent).not.toContain(en('help.select.menu_t_touch'));
  });

  spec('UI-33', 'the camera page tells a finger to pinch and twist where it tells a mouse about the wheel', async () => {
    const touch = await helpAt('camera', 'touch');
    await waitFor(() => expect(touch.textContent).toContain(shown('help.camera.wheel_b1_touch')));
    for (const key of ['help.camera.wheel_t_touch', 'help.camera.wheel_b2_touch'] as const) expect(touch.textContent, key).toContain(shown(key));
    for (const key of ['help.camera.wheel_t', 'help.camera.wheel_b1', 'help.camera.wheel_b2', 'help.camera.touch_b1'] as const) expect(touch.textContent, key).not.toContain(shown(key));
  });

  spec('UI-34', 'Help says the scale slider restores the default of the reader\'s mode, upright and sideways in touch mode', async () => {
    const touch = await helpAt('settings', 'touch');
    await waitFor(() => expect(touch.textContent).toContain('Upright and sideways each keep their own scale, 125% and 105% by default'));
    expect(touch.textContent).toContain('Double tap the track to jump back to the default: 125% upright, 105% sideways');
    expect(touch.textContent).not.toContain('100%');
    cleanup();
    const mouse = await helpAt('settings', 'pc');
    await waitFor(() => expect(mouse.textContent).toContain('Double-click the track to restore 100%'));
    expect(mouse.textContent).not.toContain('125%');
  });

  spec('UI-33', 'Help search finds the words the reader\'s mode shows', async () => {
    const results = async (inputMode: InputMode): Promise<string> => {
      await helpAt('welcome', inputMode);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pinch' } });
      return (await screen.findByRole('menu', { name: en('help.search_placeholder') })).textContent ?? '';
    };
    expect(await results('touch'), 'a finger\'s results quote the touch heading').toContain(en('help.camera.wheel_t_touch'));
    cleanup();
    expect(await results('pc'), 'a mouse\'s results do not').not.toContain(en('help.camera.wheel_t_touch'));
  });

  spec('UI-33', 'open search results reword when the input mode changes', async () => {
    setStoreState({ helpTarget: { page: 'welcome' } });
    const at = (inputMode: InputMode) => (
      <MotionConfig reducedMotion="always"><I18nProvider>
        <InputModeProvider inputMode={inputMode}><HelpModal open onClose={() => {}} /></InputModeProvider>
      </I18nProvider></MotionConfig>
    );
    const { rerender } = render(at('touch'));
    fireEvent.change(await screen.findByRole('searchbox'), { target: { value: 'pinch' } });
    const menu = () => screen.getByRole('menu', { name: en('help.search_placeholder') });
    await waitFor(() => expect(menu().textContent).toContain(en('help.camera.wheel_t_touch')));
    rerender(at('pc'));
    await waitFor(() => expect(menu().textContent).not.toContain(en('help.camera.wheel_t_touch')));
  });

  spec('UI-33', 'Help search results stand above the Help window', async () => {
    for (const inputMode of ['pc', 'touch'] as const) {
      const help = await helpAt('welcome', inputMode);
      const field = screen.getByRole('searchbox');
      fireEvent.change(field, { target: { value: 'camera' } });
      const results = await screen.findByRole('menu', { name: en('help.search_placeholder') });
      expect(rungIn(help, results), inputMode).toBeGreaterThan(rungIn(help, field));
      cleanup();
    }
  });

  spec('UI-33', 'on an upright screen Help finds the modes in the bottom bar', async () => {
    const upright = await helpAt('frame', 'pc', 'portrait');
    await waitFor(() => expect(upright.textContent).toContain(shown('help.frame.entry_upright')));
    expect(upright.textContent).not.toContain(shown('help.frame.entry'));
  });

  spec('UI-29', 'a finger holding Help\'s Close sees its name above the Help window', async () => {
    const help = await helpAt('camera', 'touch');
    const close = screen.getByRole('button', { name: en('hint.close') });
    fireEvent.pointerDown(close, { pointerType: 'touch' });
    await act(() => new Promise((done) => setTimeout(done, GESTURE_TIMING.touch.holdMs + 50)));
    const name = await screen.findByText(en('hint.close'));
    expect(rungIn(help, name), 'the name stands over the window that holds the control').toBeGreaterThan(rungIn(help, close));
  });

  spec('UI-33', 'a finger holding What\'s this reads that it taps a part of the interface', async () => {
    await helpAt('welcome', 'touch');
    const ask = screen.getByRole('button', { name: en('help.whats_this') });
    fireEvent.pointerDown(ask, { pointerType: 'touch' });
    await act(() => new Promise((done) => setTimeout(done, GESTURE_TIMING.touch.holdMs + 50)));
    expect(await screen.findByText(en('help.whats_this_tip_touch'))).toBeTruthy();
    expect(screen.queryByText(en('help.whats_this_tip'))).toBeNull();
  });
});
