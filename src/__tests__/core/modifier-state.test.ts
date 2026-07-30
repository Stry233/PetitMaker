/**
 * The shape tools read isConstrainHeld() to constrain a drag (straight/square/round). The constrain
 * key defaults to Shift but is user-rebindable, so guard that the held-key tracking honors both the
 * default modifier and a rebound non-modifier key (and the disabled/empty case).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  installModifierTracking, isConstrainHeld, setConstrainKey, isMultiSelectHeld, setMultiSelectKey,
} from '../../core/runtime/modifier-state';

installModifierTracking();
const down = (init: KeyboardEventInit): void => { window.dispatchEvent(new KeyboardEvent('keydown', init)); };
const up = (init: KeyboardEventInit): void => { window.dispatchEvent(new KeyboardEvent('keyup', init)); };

describe('modifier-state: rebindable constrain key', () => {
  beforeEach(() => { setConstrainKey('shift'); window.dispatchEvent(new Event('blur')); });

  it('constrains on Shift by default', () => {
    expect(isConstrainHeld()).toBe(false);
    down({ key: 'Shift', shiftKey: true });
    expect(isConstrainHeld()).toBe(true);
    up({ key: 'Shift', shiftKey: false });
    expect(isConstrainHeld()).toBe(false);
  });

  it('honors a rebound non-modifier key and ignores Shift then', () => {
    setConstrainKey('x');
    down({ key: 'Shift', shiftKey: true });
    expect(isConstrainHeld()).toBe(false); // Shift does not constrain once the key is rebound
    up({ key: 'Shift', shiftKey: false });
    down({ key: 'x', code: 'KeyX' });
    expect(isConstrainHeld()).toBe(true);
    up({ key: 'x', code: 'KeyX' });
    expect(isConstrainHeld()).toBe(false);
  });

  it('an empty constrain key disables constraining', () => {
    setConstrainKey('');
    down({ key: 'Shift', shiftKey: true });
    expect(isConstrainHeld()).toBe(false);
  });
});

/**
 * The pointer machine reads isMultiSelectHeld() to turn a click into a membership toggle and a drag
 * into a rubber band. The multi-select key defaults to Ctrl but is user-rebindable, mirroring the
 * shape constrain key including the blur reset: a keyup never arrives if focus leaves mid-hold, and
 * a modifier stuck on would silently turn every later click into a toggle.
 */
describe('modifier-state: rebindable multi-select key', () => {
  beforeEach(() => { setMultiSelectKey('ctrl'); window.dispatchEvent(new Event('blur')); });

  it('multi-selects on Ctrl by default', () => {
    expect(isMultiSelectHeld()).toBe(false);
    down({ key: 'Control', ctrlKey: true });
    expect(isMultiSelectHeld()).toBe(true);
    up({ key: 'Control', ctrlKey: false });
    expect(isMultiSelectHeld()).toBe(false);
  });

  it('honors a rebound non-modifier key and ignores Ctrl then', () => {
    setMultiSelectKey('x');
    down({ key: 'Control', ctrlKey: true });
    expect(isMultiSelectHeld()).toBe(false); // Ctrl does not multi-select once the key is rebound
    up({ key: 'Control', ctrlKey: false });
    down({ key: 'x', code: 'KeyX' });
    expect(isMultiSelectHeld()).toBe(true);
    up({ key: 'x', code: 'KeyX' });
    expect(isMultiSelectHeld()).toBe(false);
  });

  it('a window blur mid-hold clears the held state, since the keyup never arrives', () => {
    down({ key: 'Control', ctrlKey: true });
    expect(isMultiSelectHeld()).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(isMultiSelectHeld()).toBe(false);
  });

  it('tracks the multi-select modifier via a literal (non-"ctrl") token like any rebound key', () => {
    // Exercises the generic heldTokens fallback path directly with the browser's own native token
    // for the Control key ('control', not the combo grammar's 'ctrl').
    setMultiSelectKey('control');
    expect(isMultiSelectHeld()).toBe(false);
    down({ key: 'Control' });
    expect(isMultiSelectHeld()).toBe(true);
    up({ key: 'Control' });
    expect(isMultiSelectHeld()).toBe(false);
  });
});

describe('the multi-select modifier on macOS', () => {
  it('counts Cmd as Ctrl, because on a Mac Ctrl+click is the secondary click', () => {
    // A Mac user holding the literal Ctrl to add to a selection would be opening context
    // menus. ShortcutManager already aliases Cmd for every ctrl+* binding; this matches it.
    setMultiSelectKey('ctrl');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    expect(isMultiSelectHeld()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', metaKey: false }));
    expect(isMultiSelectHeld()).toBe(false);
  });
});
