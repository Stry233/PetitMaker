// @vitest-environment jsdom
// The Settings UI-scale slider, bound to the store's uiZoom like the Ctrl+/- shortcut.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from '../../../../../ui/chrome/modals/settings/SettingsModal';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { setStoreState } from '../../../../_support/store';
import { poseLegacyZoom } from '../../../../_support/legacy-zoom';
import { NO_DOCK, reachOf } from '../../../../../ui/design/scale';
import { spec } from '../../../../_support/spec';

function renderModal() {
  return render(
    <I18nProvider>
      <SettingsModal open onClose={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  setStoreState({ locale: 'en', uiZoom: 1 });
  localStorage.clear();
});

describe('SettingsModal — UI-scale slider', () => {
  spec('UI-34', 'the reset button stands at the default, unavailable, and restores the default after a change', () => {
    renderModal();
    const reset = () => screen.getByRole('button', { name: 'UI scale 100%' });
    expect(reset().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(reset());
    expect(useEditorStore.getState().uiZoom).toBe(1);

    fireEvent.keyDown(screen.getByRole('slider', { name: 'UI scale' }), { key: 'ArrowRight' });
    expect(useEditorStore.getState().uiZoom).toBe(1.05);
    expect(reset().getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(reset());
    expect(useEditorStore.getState().uiZoom).toBe(1);
    expect(reset().getAttribute('aria-disabled')).toBe('true');
  });

  it('renders a labelled role=slider with the i18n label and 60/180 aria bounds', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    expect(slider).toBeTruthy();
    expect(slider.getAttribute('aria-valuemin')).toBe('60');
    expect(slider.getAttribute('aria-valuemax')).toBe('180');
    expect(slider.getAttribute('aria-valuenow')).toBe('100');
    expect(slider.getAttribute('aria-valuetext')).toBe('100%');
    expect(slider.getAttribute('tabindex')).toBe('0');
  });

  it('reflects the current uiZoom in the slider aria-valuetext', () => {
    setStoreState({ uiZoom: 1.15 });
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    expect(slider.getAttribute('aria-valuenow')).toBe('115');
    expect(slider.getAttribute('aria-valuetext')).toBe('115%');
  });

  it('reveals the value bubble over the knob on hover, showing the live %', () => {
    setStoreState({ uiZoom: 1.15 });
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    fireEvent.pointerEnter(slider);
    expect(screen.getByText('115%')).toBeTruthy();
  });

  it('arrow keys step uiZoom by 0.05 within the store clamps', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useEditorStore.getState().uiZoom).toBe(1.05);

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(useEditorStore.getState().uiZoom).toBe(0.95);

    fireEvent.keyDown(slider, { key: 'Home' });
    expect(useEditorStore.getState().uiZoom).toBe(0.6);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(useEditorStore.getState().uiZoom).toBe(0.6);

    fireEvent.keyDown(slider, { key: 'End' });
    expect(useEditorStore.getState().uiZoom).toBe(1.8);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useEditorStore.getState().uiZoom).toBe(1.8);
  });

  it('reflects the live store value in aria-valuenow after a keyboard change', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(screen.getByRole('slider', { name: 'UI scale' }).getAttribute('aria-valuenow')).toBe('105');
    expect(screen.getByRole('slider', { name: 'UI scale' }).getAttribute('aria-valuetext')).toBe('105%');
  });

  // jsdom has no PointerEvent, so fireEvent.pointer* drops clientX; a MouseEvent of the pointer type
  // carries it and React's pointer handlers still catch it.
  const mockRect = (el: Element) => {
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 24, width: 200, height: 24, x: 0, y: 0, toJSON() {} }) as DOMRect;
  };
  const ptr = (el: Element, type: string, init: MouseEventInit) =>
    fireEvent(el, new MouseEvent(type, { bubbles: true, ...init }));

  // A drag writes the store only on release, so the chrome's CSS zoom cannot rescale the slider
  // mid-drag.
  it('pointer drag updates only local visuals; the store commits on pointer release', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    mockRect(slider);

    ptr(slider, 'pointerdown', { clientX: 100 });
    expect(useEditorStore.getState().uiZoom).toBe(1);

    // 150 of 200 is 0.75 of the track: 0.6 + 0.75 * 1.2 = 1.5.
    ptr(slider, 'pointermove', { clientX: 150, buttons: 1 });
    expect(useEditorStore.getState().uiZoom).toBe(1);
    expect(screen.getByRole('slider', { name: 'UI scale' }).getAttribute('aria-valuenow')).toBe('150');

    ptr(slider, 'pointerup', { clientX: 150 });
    expect(useEditorStore.getState().uiZoom).toBe(1.5);
  });

  it('a cancelled pointer drag still commits the pending value', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    mockRect(slider);

    ptr(slider, 'pointerdown', { clientX: 50 });
    ptr(slider, 'pointermove', { clientX: 50, buttons: 1 }); // 0.6 + 0.25 * 1.2 = 0.9
    expect(useEditorStore.getState().uiZoom).toBe(1);
    ptr(slider, 'pointercancel', {});
    expect(useEditorStore.getState().uiZoom).toBe(0.9);
  });

  it('maps the pointer against the screen rect of the track on an engine that measures zoomed subtrees in their own pixels', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    // Inside a zoom 0.5 card the track's own-pixel reading is twice its screen size: screen 50..250.
    slider.getBoundingClientRect = () =>
      ({ left: 100, top: 0, right: 500, bottom: 24, width: 400, height: 24, x: 100, y: 0, toJSON() {} }) as DOMRect;
    const card = slider.parentElement!;
    const restore = poseLegacyZoom((node) => (node === card ? 0.5 : 1));
    try {
      ptr(slider, 'pointerdown', { clientX: 250 });
      ptr(slider, 'pointerup', { clientX: 250 });
      expect(useEditorStore.getState().uiZoom).toBe(1.8);
    } finally {
      restore();
    }
  });

  it('ends its range where this window stops responding to a larger scale', () => {
    const tall = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    try {
      renderModal();
      const slider = screen.getByRole('slider', { name: 'UI scale' });
      const reach = reachOf({ vw: window.innerWidth, vh: 500, dock: NO_DOCK, touch: false, upright: false, uiZoom: 1, room: null });
      const max = Math.floor(reach * 10 + 1e-6) / 10;
      expect(max).toBeLessThan(1.8);
      expect(slider.getAttribute('aria-valuemax')).toBe(String(Math.round(max * 100)));
      fireEvent.keyDown(slider, { key: 'End' });
      expect(useEditorStore.getState().uiZoom).toBeCloseTo(max, 6);
      // A press at the track's far end lands on that maximum, not on 180%.
      mockRect(slider);
      ptr(slider, 'pointerdown', { clientX: 200 });
      ptr(slider, 'pointerup', { clientX: 200 });
      expect(useEditorStore.getState().uiZoom).toBeCloseTo(max, 6);
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: tall });
    }
  });

  it('keeps the whole range where every scale is reachable', () => {
    renderModal();
    expect(screen.getByRole('slider', { name: 'UI scale' }).getAttribute('aria-valuemax')).toBe('180');
    expect(screen.queryByTestId('ui-scale-unreachable')).toBeNull();
  });

  it('double-clicking the track resets uiZoom to 1.0', () => {
    setStoreState({ uiZoom: 1.4 });
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    fireEvent.doubleClick(slider);
    expect(useEditorStore.getState().uiZoom).toBe(1);
  });

  it('persists via the same key as the Ctrl± shortcut (petit-planet-ui-zoom)', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(localStorage.getItem('petit-planet-ui-zoom')).toBe('1.05');
  });
});
