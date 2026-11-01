// @vitest-environment jsdom
/**
 * The UI-scale keys have no run body: this always-live listener is what carries them out. It reads
 * their effective bindings, so a rebind has to reach it, and it stays live behind an open modal
 * while still standing aside for a text field.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { UiZoomShortcut } from '../../../ui/app/use-ui-zoom-shortcut';
import { useKeybinds } from '../../../state/keymap/store';
import { useEditorStore } from '../../../state/store';

/** Dispatch a keydown at `target` (window by default) and report whether it was consumed. */
function press(init: KeyboardEventInit, target: EventTarget = window): boolean {
  const e = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(e); });
  return e.defaultPrevented;
}

const zoom = (): number => useEditorStore.getState().uiZoom;

beforeEach(() => {
  useKeybinds.setState({ overrides: {} });
  useEditorStore.getState().setUiZoom(1);
});
afterEach(() => {
  useKeybinds.setState({ overrides: {} });
  useEditorStore.getState().setUiZoom(1);
});

describe('the UI-scale listener', () => {
  it('steps the scale on the shipped keys, in both spellings of the keycap', () => {
    const view = render(<UiZoomShortcut />);
    expect(press({ key: '=', ctrlKey: true })).toBe(true);
    expect(zoom()).toBeCloseTo(1.05, 5);
    expect(press({ key: '_', ctrlKey: true, shiftKey: true })).toBe(true); // the - keycap, shifted
    expect(zoom()).toBeCloseTo(1, 5);
    view.unmount();
  });

  it('follows a rebind, live, and drops the key it left behind', () => {
    const view = render(<UiZoomShortcut />);
    act(() => { useKeybinds.getState().rebind('app.ui_zoom_in', 'ctrl+9'); });
    expect(press({ key: '=', ctrlKey: true })).toBe(false);
    expect(zoom()).toBeCloseTo(1, 5);
    expect(press({ key: '9', ctrlKey: true })).toBe(true);
    expect(zoom()).toBeCloseTo(1.05, 5);
    view.unmount();
  });

  it('follows a rebind onto a numpad key', () => {
    const view = render(<UiZoomShortcut />);
    act(() => { useKeybinds.getState().rebind('app.ui_zoom_in', 'ctrl+numadd'); });
    expect(press({ key: '+', code: 'NumpadAdd', ctrlKey: true })).toBe(true);
    expect(zoom()).toBeCloseTo(1.05, 5);
    view.unmount();
  });

  it('an unbound direction has no key at all', () => {
    const view = render(<UiZoomShortcut />);
    act(() => { useKeybinds.getState().clear('app.ui_zoom_out'); });
    expect(press({ key: '-', ctrlKey: true })).toBe(false);
    expect(zoom()).toBeCloseTo(1, 5);
    view.unmount();
  });

  it('stands aside while the user is typing', () => {
    const view = render(<UiZoomShortcut />);
    act(() => { useKeybinds.getState().rebind('app.ui_zoom_in', 'j'); });
    const field = document.createElement('input');
    document.body.appendChild(field);
    expect(press({ key: 'j' }, field)).toBe(false);
    expect(zoom()).toBeCloseTo(1, 5);
    // The same press away from the field still scales.
    expect(press({ key: 'j' })).toBe(true);
    expect(zoom()).toBeCloseTo(1.05, 5);
    field.remove();
    view.unmount();
  });

  it('[UI-34] keeps touch mode on its own stops, 60% to 180% through 125% upright', () => {
    act(() => { useEditorStore.getState().setLayoutShape('portrait'); useEditorStore.getState().setInputMode('touch'); });
    try {
      render(<UiZoomShortcut />);
      expect(zoom()).toBe(1.25);
      press({ key: '=', ctrlKey: true });
      expect(zoom()).toBe(1.3);
      for (let i = 0; i < 20; i++) press({ key: '=', ctrlKey: true });
      expect(zoom(), 'the top stop').toBe(1.8);
      for (let i = 0; i < 40; i++) press({ key: '-', ctrlKey: true });
      expect(zoom(), 'the bottom stop').toBe(0.6);
    } finally {
      act(() => { useEditorStore.getState().setUiZoom(1.25); useEditorStore.getState().setInputMode('pc'); });
    }
  });
});
