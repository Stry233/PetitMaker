// @vitest-environment jsdom
/**
 * The held commands follow the keymap: each waits on the last segment of its effective combo, so
 * the default modifier, a rebound non-modifier key and an unbound command (never held) all hold.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { installKeyTracking } from '../../../platform/input/held-keys';
import { isCommandHeld, onCommandHeldChange } from '../../../state/keymap/held';
import { useKeybinds } from '../../../state/keymap/store';

installKeyTracking();
const down = (init: KeyboardEventInit): void => { window.dispatchEvent(new KeyboardEvent('keydown', init)); };
const up = (init: KeyboardEventInit): void => { window.dispatchEvent(new KeyboardEvent('keyup', init)); };
const keymap = () => useKeybinds.getState();

beforeEach(() => { keymap().resetAll(); window.dispatchEvent(new Event('blur')); });
afterAll(() => keymap().resetAll());

describe('the constrain command', () => {
  it('constrains on Shift by default', () => {
    expect(isCommandHeld('tool.constrain')).toBe(false);
    down({ key: 'Shift', shiftKey: true });
    expect(isCommandHeld('tool.constrain')).toBe(true);
    up({ key: 'Shift', shiftKey: false });
    expect(isCommandHeld('tool.constrain')).toBe(false);
  });

  it('honors a rebound non-modifier key and ignores Shift then', () => {
    keymap().rebind('tool.constrain', 'x');
    down({ key: 'Shift', shiftKey: true });
    expect(isCommandHeld('tool.constrain')).toBe(false);
    up({ key: 'Shift', shiftKey: false });
    down({ key: 'x', code: 'KeyX' });
    expect(isCommandHeld('tool.constrain')).toBe(true);
    up({ key: 'x', code: 'KeyX' });
    expect(isCommandHeld('tool.constrain')).toBe(false);
  });

  it('is never held once unbound', () => {
    keymap().clear('tool.constrain');
    down({ key: 'Shift', shiftKey: true });
    expect(isCommandHeld('tool.constrain')).toBe(false);
  });

  it.each([
    ['Ctrl', { key: 'Control', code: 'ControlLeft', ctrlKey: true }],
    ['Cmd', { key: 'Meta', code: 'MetaLeft', metaKey: true }],
  ])('honors a constrain key rebound to bare ctrl, held on %s', (_name, init: KeyboardEventInit) => {
    keymap().rebind('tool.constrain', 'ctrl');
    down(init);
    expect(isCommandHeld('tool.constrain')).toBe(true);
    up({ key: init.key, code: init.code });
    expect(isCommandHeld('tool.constrain')).toBe(false);
  });
});

/**
 * Multi-select turns a click into a membership toggle and a drag into a rubber band. A keyup never
 * arrives if focus leaves mid-hold, and a modifier stuck on would silently turn every later click
 * into a toggle.
 */
describe('the multi-select command', () => {
  it('multi-selects on Ctrl by default', () => {
    expect(isCommandHeld('selection.multi')).toBe(false);
    down({ key: 'Control', ctrlKey: true });
    expect(isCommandHeld('selection.multi')).toBe(true);
    up({ key: 'Control', ctrlKey: false });
    expect(isCommandHeld('selection.multi')).toBe(false);
  });

  it('honors a rebound non-modifier key and ignores Ctrl then', () => {
    keymap().rebind('selection.multi', 'x');
    down({ key: 'Control', ctrlKey: true });
    expect(isCommandHeld('selection.multi')).toBe(false);
    up({ key: 'Control', ctrlKey: false });
    down({ key: 'x', code: 'KeyX' });
    expect(isCommandHeld('selection.multi')).toBe(true);
    up({ key: 'x', code: 'KeyX' });
    expect(isCommandHeld('selection.multi')).toBe(false);
  });

  it('a window blur mid-hold clears the held state, since the keyup never arrives', () => {
    down({ key: 'Control', ctrlKey: true });
    expect(isCommandHeld('selection.multi')).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(isCommandHeld('selection.multi')).toBe(false);
  });

  it('counts Cmd as Ctrl, because on a Mac Ctrl+click is the secondary click', () => {
    down({ key: 'Meta', metaKey: true });
    expect(isCommandHeld('selection.multi')).toBe(true);
    up({ key: 'Meta', metaKey: false });
    expect(isCommandHeld('selection.multi')).toBe(false);
  });
});

describe('onCommandHeldChange', () => {
  it('announces a press and a release of the command, not of other keys or repeats', () => {
    let calls = 0;
    const off = onCommandHeldChange('camera.pan_drag', () => { calls++; });
    down({ key: 'x', code: 'KeyX' });
    expect(calls).toBe(0);
    down({ key: ' ', code: 'Space' });
    down({ key: ' ', code: 'Space', repeat: true });
    expect(calls).toBe(1);
    up({ key: ' ', code: 'Space' });
    expect(calls).toBe(2);
    off();
    down({ key: ' ', code: 'Space' });
    expect(calls).toBe(2);
  });

  it('announces a rebind that moves the command off a held key', () => {
    let calls = 0;
    const off = onCommandHeldChange('camera.pan_drag', () => { calls++; });
    down({ key: ' ', code: 'Space' });
    expect(calls).toBe(1);
    keymap().clear('camera.pan_drag');
    expect(isCommandHeld('camera.pan_drag')).toBe(false);
    expect(calls).toBe(2);
    off();
  });
});
