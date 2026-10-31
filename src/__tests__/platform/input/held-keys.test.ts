// @vitest-environment jsdom
/** The held-key tracker answers by binding token, whatever the browser names the key. */
import { describe, it, expect, afterEach } from 'vitest';
import { __resetHeldKeys, anyKeyHeld, installKeyTracking, isKeyHeld } from '../../../platform/input/held-keys';

const down = (init: KeyboardEventInit): void => { window.dispatchEvent(new KeyboardEvent('keydown', init)); };

afterEach(() => __resetHeldKeys());

describe('held keys', () => {
  it('reads every spelling of a modifier from its own flag', () => {
    installKeyTracking();
    down({ key: 'Control', ctrlKey: true });
    for (const token of ['ctrl', 'control', 'meta', 'cmd']) expect(isKeyHeld(token), token).toBe(true);
    expect(isKeyHeld('shift')).toBe(false);
  });

  it('tracks a numpad key by its own token', () => {
    installKeyTracking();
    down({ key: '8', code: 'Numpad8' });
    expect(isKeyHeld('num8')).toBe(true);
    expect(isKeyHeld('8')).toBe(false);
  });

  it('never holds the empty token', () => {
    installKeyTracking();
    down({ key: 'x', code: 'KeyX' });
    expect(isKeyHeld('')).toBe(false);
  });

  it('forgets every key and its listeners on reset', () => {
    installKeyTracking();
    down({ key: 'x', code: 'KeyX' });
    __resetHeldKeys();
    expect(isKeyHeld('x')).toBe(false);
    down({ key: 'x', code: 'KeyX' });
    expect(isKeyHeld('x')).toBe(false);
  });
});

describe('every key let go', () => {
  const up = (init: KeyboardEventInit): void => { window.dispatchEvent(new KeyboardEvent('keyup', init)); };

  it('holds nothing once a shifted digit and its Shift are let go, Shift first', () => {
    installKeyTracking();
    down({ key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    down({ key: '!', code: 'Digit1', shiftKey: true });
    up({ key: 'Shift', code: 'ShiftLeft' });
    up({ key: '1', code: 'Digit1' });
    expect(anyKeyHeld()).toBe(false);
  });

  it('holds nothing once Cmd is let go, macOS sending no keyup for a key pressed under it', () => {
    installKeyTracking();
    down({ key: 'Meta', code: 'MetaLeft', metaKey: true });
    down({ key: 'z', code: 'KeyZ', metaKey: true });
    up({ key: 'Meta', code: 'MetaLeft' });
    expect(anyKeyHeld()).toBe(false);
    expect(isKeyHeld('z')).toBe(false);
  });

  it('keeps a key down while a modifier comes and goes', () => {
    installKeyTracking();
    down({ key: 'x', code: 'KeyX' });
    down({ key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    up({ key: 'Shift', code: 'ShiftLeft' });
    expect(isKeyHeld('x')).toBe(true);
    up({ key: 'x', code: 'KeyX' });
    expect(anyKeyHeld()).toBe(false);
  });
});
