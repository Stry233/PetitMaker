// @vitest-environment jsdom
/** The held-key tracker answers by binding token, whatever the browser names the key. */
import { describe, it, expect, afterEach } from 'vitest';
import { __resetHeldKeys, installKeyTracking, isKeyHeld } from '../../../platform/input/held-keys';

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
