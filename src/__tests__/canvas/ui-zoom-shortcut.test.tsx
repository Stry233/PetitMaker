/**
 * The UI-scale keys have no RUN body: this always-live listener is what carries them out. It reads
 * their effective bindings, so a rebind has to reach it, and it stays live behind an open modal
 * while still standing aside for a text field.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useUiZoomShortcut } from '../../canvas/interaction/use-view-shortcuts';
import { useKeybinds } from '../../core/runtime/keybindings';
import { useEditorStore } from '../../state/store';

function Zoomer() {
  useUiZoomShortcut();
  return null;
}

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
    const view = render(<Zoomer />);
    expect(press({ key: '=', ctrlKey: true })).toBe(true);
    expect(zoom()).toBeCloseTo(1.1, 5);
    expect(press({ key: '_', ctrlKey: true, shiftKey: true })).toBe(true); // the - keycap, shifted
    expect(zoom()).toBeCloseTo(1, 5);
    view.unmount();
  });

  it('follows a rebind, live, and drops the key it left behind', () => {
    const view = render(<Zoomer />);
    act(() => { useKeybinds.getState().rebind('app.ui_zoom_in', 'ctrl+9'); });
    expect(press({ key: '=', ctrlKey: true })).toBe(false);
    expect(zoom()).toBeCloseTo(1, 5);
    expect(press({ key: '9', ctrlKey: true })).toBe(true);
    expect(zoom()).toBeCloseTo(1.1, 5);
    view.unmount();
  });

  it('an unbound direction has no key at all', () => {
    const view = render(<Zoomer />);
    act(() => { useKeybinds.getState().clear('app.ui_zoom_out'); });
    expect(press({ key: '-', ctrlKey: true })).toBe(false);
    expect(zoom()).toBeCloseTo(1, 5);
    view.unmount();
  });

  it('stands aside while the user is typing', () => {
    const view = render(<Zoomer />);
    act(() => { useKeybinds.getState().rebind('app.ui_zoom_in', 'j'); });
    const field = document.createElement('input');
    document.body.appendChild(field);
    expect(press({ key: 'j' }, field)).toBe(false);
    expect(zoom()).toBeCloseTo(1, 5);
    // The same press away from the field still scales.
    expect(press({ key: 'j' })).toBe(true);
    expect(zoom()).toBeCloseTo(1.1, 5);
    field.remove();
    view.unmount();
  });
});
