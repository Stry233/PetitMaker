// @vitest-environment jsdom
/**
 * A surface that is hidden, covered or on its way out takes no input and is no longer read: its root
 * wears `inert` and `aria-hidden` from the first frame it goes, and nothing inside it writes itself
 * visible over a hidden ancestor. Where a press then lands is checked in a browser.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { I18nProvider, translate } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Shell } from '../../../ui/shell/Shell';
import { setStoreState } from '../../_support/store';

/** Animations play, so a leaving surface stands through its fade. */
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MotionConfig reducedMotion="never"><I18nProvider>{children}</I18nProvider></MotionConfig>
);
const mount = () => render(<Shell><div data-testid="map-views" /></Shell>, { wrapper });

/** A screen in the bar's place fades on Web Animations, which jsdom lacks: this one never finishes. */
function holdWebAnimations() {
  const animate = vi.fn(() => ({ playState: 'running', pending: false, cancel() {}, finished: new Promise(() => {}) }));
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate });
}

/** Whether `el` takes no input and is not read: an inert, aria-hidden root stands over it. */
const away = (el: Element) => el.closest('[inert]') !== null && el.closest('[aria-hidden="true"]') !== null;

beforeEach(() => {
  setStoreState({ locale: 'en' });
  useEditorStore.getState().setSelectingRegion(false);
  useEditorStore.getState().setEditMode({ mode: null });
  useEditorStore.getState().setAssistantOpen(false);
});
afterEach(() => {
  cleanup();
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe('a bar on its way out', () => {
  spec('UI-68', 'a mode\'s bar leaving for the next mode\'s takes no input from its first exit frame', () => {
    act(() => useEditorStore.getState().setEditMode({ mode: 'generate' }));
    mount();
    const leaving = screen.getByTestId('shell-gen-body');
    expect(away(leaving)).toBe(false);
    act(() => useEditorStore.getState().setEditMode({ mode: 'object' }));
    expect(leaving.isConnected, 'the generate shelf still fades where it stood').toBe(true);
    expect(away(leaving)).toBe(true);
  });

  spec('UI-68', 'a screen standing in the bar\'s place takes no input once it starts to leave, and the bar under it none while covered', () => {
    holdWebAnimations();
    act(() => {
      useEditorStore.getState().setEditMode({ mode: 'generate' });
      useEditorStore.getState().setAssistantOpen(true);
    });
    mount();
    const bar = screen.getByTestId('shell-mode-bar');
    act(() => useEditorStore.getState().setSelectingRegion(true, 'agent'));
    const cover = screen.getByTestId('shell-scope-screen');
    expect(away(cover)).toBe(false);
    expect(away(bar)).toBe(true);
    act(() => useEditorStore.getState().setSelectingRegion(false));
    expect(cover.isConnected, 'the screen still fades where it stood').toBe(true);
    expect(away(cover)).toBe(true);
  });
});

describe('the interface put away', () => {
  spec('UI-68', 'hiding the interface takes the bottom bar away with it, and nothing in it shows itself over the veil', () => {
    act(() => useEditorStore.getState().setEditMode({ mode: 'generate' }));
    mount();
    const bar = screen.getByTestId('shell-mode-bar');
    expect(away(bar)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: translate('a11y.hide_ui') }));
    expect(away(bar)).toBe(true);
    for (let el: HTMLElement | null = bar; el; el = el.parentElement) expect(el.style.visibility, el.dataset.testid).not.toBe('visible');
  });
});
