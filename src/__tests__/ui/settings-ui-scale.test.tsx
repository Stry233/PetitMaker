// SettingsModal — UI-scale slider (mirrors the Ctrl+(+/−) uiZoom shortcut).
//
// The slider is bound directly to the store's uiZoom / setUiZoom (the SAME
// single persistence path the keyboard shortcut uses), so these tests drive the
// real store and assert both the store field and the slider's aria state. Plain
// DOM checks (getAttribute / toBe) match sibling UI tests — no jest-dom.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal, type SettingsModalProps } from '../../ui/chrome/SettingsModal';
import { I18nProvider } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { setStoreState } from '../_store';

function noop() {}

function renderModal(overrides: Partial<SettingsModalProps> = {}) {
  const props: SettingsModalProps = {
    open: true,
    locale: 'en',
    showGrid: false,
    showChunks: false,
    motionPref: 'system',
    systemCursors: false,
    onLocaleChange: noop,
    onShowGridChange: noop,
    onShowChunksChange: noop,
    onMotionPrefChange: noop,
    onSystemCursorsChange: noop,
    onAbout: noop,
    onClose: noop,
    ...overrides,
  };
  return render(
    <I18nProvider>
      <SettingsModal {...props} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  setStoreState({ locale: 'en', uiZoom: 1 });
  localStorage.clear();
});

describe('SettingsModal — UI-scale slider', () => {
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

  it('arrow keys step uiZoom by 0.1 within the store clamps', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useEditorStore.getState().uiZoom).toBe(1.1);

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(useEditorStore.getState().uiZoom).toBe(0.9);

    // Clamp floor at 0.6 — Home jumps to the minimum, further Left is a no-op.
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(useEditorStore.getState().uiZoom).toBe(0.6);
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(useEditorStore.getState().uiZoom).toBe(0.6);

    // Clamp ceiling at 1.8 — End jumps to the maximum, further Right is a no-op.
    fireEvent.keyDown(slider, { key: 'End' });
    expect(useEditorStore.getState().uiZoom).toBe(1.8);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(useEditorStore.getState().uiZoom).toBe(1.8);
  });

  it('reflects the live store value in aria-valuenow after a keyboard change', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(screen.getByRole('slider', { name: 'UI scale' }).getAttribute('aria-valuenow')).toBe('110');
    expect(screen.getByRole('slider', { name: 'UI scale' }).getAttribute('aria-valuetext')).toBe('110%');
  });

  // jsdom has no real PointerEvent, so fireEvent.pointer* drops clientX; dispatch a
  // MouseEvent of the pointer type instead — React's pointer handlers catch it and it
  // carries clientX. Track a 200px-wide slider at a fixed origin.
  const mockRect = (el: Element) => {
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 24, width: 200, height: 24, x: 0, y: 0, toJSON() {} }) as DOMRect;
  };
  const ptr = (el: Element, type: string, init: MouseEventInit) =>
    fireEvent(el, new MouseEvent(type, { bubbles: true, ...init }));

  // APPLY-ON-RELEASE: a pointer drag must not write the store until release, so the
  // chrome CSS-zoom feedback loop can't rescale the slider mid-drag. The knob still
  // tracks the pointer live via aria-valuenow (local drag state).
  it('pointer drag updates only local visuals; the store commits on pointer release', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    mockRect(slider);

    ptr(slider, 'pointerdown', { clientX: 100 });
    expect(useEditorStore.getState().uiZoom).toBe(1); // no commit on press

    // clientX 150 of width 200 → frac 0.75 → 0.6 + 0.75*1.2 = 1.5.
    ptr(slider, 'pointermove', { clientX: 150, buttons: 1 });
    expect(useEditorStore.getState().uiZoom).toBe(1); // still no commit while dragging
    expect(screen.getByRole('slider', { name: 'UI scale' }).getAttribute('aria-valuenow')).toBe('150'); // knob tracks live

    ptr(slider, 'pointerup', { clientX: 150 });
    expect(useEditorStore.getState().uiZoom).toBe(1.5); // commit on release
  });

  it('a cancelled pointer drag still commits the pending value', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    mockRect(slider);

    ptr(slider, 'pointerdown', { clientX: 50 });
    ptr(slider, 'pointermove', { clientX: 50, buttons: 1 }); // frac 0.25 → 0.6+0.3 = 0.9
    expect(useEditorStore.getState().uiZoom).toBe(1);
    ptr(slider, 'pointercancel', {});
    expect(useEditorStore.getState().uiZoom).toBe(0.9);
  });

  it('double-clicking the track resets uiZoom to 1.0', () => {
    setStoreState({ uiZoom: 1.4 });
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    fireEvent.doubleClick(slider);
    expect(useEditorStore.getState().uiZoom).toBe(1);
  });

  it('shows a reset pill only when off-default; clicking it returns to 100%', () => {
    // Default (100%) — no reset affordance.
    const { unmount } = renderModal();
    expect(screen.queryByRole('button', { name: /UI scale 100%/ })).toBeNull();
    unmount();

    // Off-default — the reset pill appears and resets on click.
    setStoreState({ uiZoom: 1.3 });
    renderModal();
    const reset = screen.getByRole('button', { name: /UI scale 100%/ });
    fireEvent.click(reset);
    expect(useEditorStore.getState().uiZoom).toBe(1);
  });

  it('persists via the same key as the Ctrl± shortcut (petit-planet-ui-zoom)', () => {
    renderModal();
    const slider = screen.getByRole('slider', { name: 'UI scale' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(localStorage.getItem('petit-planet-ui-zoom')).toBe('1.1');
  });
});
