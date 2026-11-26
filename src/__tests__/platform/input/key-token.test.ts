// @vitest-environment jsdom
/**
 * eventKeyToken is the one KeyboardEvent→token map shared by the shortcut engine, the chord
 * recorder and the held-modifier tracker. The default keymap binds tools to the top-row digits
 * ('1'..'8'), but on AZERTY (and other non-QWERTY layouts) the unshifted digit row types a
 * symbol, not the digit (French Digit1 → '&'), so those bindings would never fire without a
 * physical-row fallback. Letters are deliberately excluded (WASD-style bindings follow the
 * layout's own keycap), and a shifted digit combo reads first by the symbol it types; the engine also
 * reads it as its digit, which a cycle's way back on Shift and a digit relies on.
 */
import { describe, it, expect, vi } from 'vitest';
import { eventKeyToken, eventKeyTokens, shiftKeepsToken } from '../../../platform/input/key-token';
import { ShortcutManager } from '../../../platform/input/shortcut-manager';

const ev = (init: Partial<KeyboardEvent>): KeyboardEvent => init as KeyboardEvent;

describe('eventKeyTokens: what the shortcut engine matches a press by', () => {
  it('reads Shift on the digit row as the symbol it types, then as its digit', () => {
    expect(eventKeyTokens(ev({ key: '%', shiftKey: true, code: 'Digit5' }))).toEqual(['%', '5']);
    // A Russian Shift+7 types '?', which shift+? keeps before the digit.
    expect(eventKeyTokens(ev({ key: '?', shiftKey: true, code: 'Digit7' }))).toEqual(['?', '7']);
    expect(eventKeyTokens(ev({ key: '5', shiftKey: true, code: 'Digit5' }))).toEqual(['5']);
  });

  it('reads any other press once', () => {
    expect(eventKeyTokens(ev({ key: '<', shiftKey: true, code: 'Comma' }))).toEqual(['<']);
    expect(eventKeyTokens(ev({ key: 'L', shiftKey: true, code: 'KeyL' }))).toEqual(['l']);
    expect(eventKeyTokens(ev({ key: '&', code: 'Digit1' }))).toEqual(['1']);
  });
});

describe('shiftKeepsToken', () => {
  it('holds for Latin letters and digits, and not for a key whose character with Shift depends on the layout', () => {
    expect(['l', 'q', '5', '0'].map(shiftKeepsToken)).toEqual([true, true, true, true]);
    // A French ù types % with Shift; numpad digits lose Shift to NumLock on Windows.
    expect([',', '[', 'ù', 'ß', 'д', 'num5', 'space', 'dead'].map(shiftKeepsToken)).toEqual([false, false, false, false, false, false, false, false]);
  });
});

describe('eventKeyToken: physical digit-row fallback', () => {
  it('falls back to the code-named digit when the unshifted key is a layout symbol (AZERTY)', () => {
    expect(eventKeyToken(ev({ key: '&', code: 'Digit1' }))).toBe('1');
    expect(eventKeyToken(ev({ key: 'é', code: 'Digit2' }))).toBe('2');
  });

  it('is byte-identical on QWERTY, where the key already matches the digit', () => {
    expect(eventKeyToken(ev({ key: '1', code: 'Digit1' }))).toBe('1');
    expect(eventKeyToken(ev({ key: '0', code: 'Digit0' }))).toBe('0');
  });

  it('leaves a shifted digit combo character-based', () => {
    expect(eventKeyToken(ev({ key: '?', shiftKey: true, code: 'Digit1' }))).toBe('?');
  });

  it('does not touch letters: a layout that types a different letter on a physical key keeps its own key', () => {
    // AZERTY's physical Q key types 'a'; the token must follow the keycap, not the position.
    expect(eventKeyToken(ev({ key: 'a', code: 'KeyQ' }))).toBe('a');
  });

  it('leaves numpad tokens untouched', () => {
    expect(eventKeyToken(ev({ key: '1', code: 'Numpad1' }))).toBe('num1');
    expect(eventKeyToken(ev({ key: '+', code: 'NumpadAdd' }))).toBe('numadd');
  });
});

describe('the shortcut engine fires digit-row bindings from the physical key', () => {
  it('an AZERTY "&"/Digit1 keydown fires the command bound to "1"', () => {
    const mgr = new ShortcutManager();
    const action = vi.fn();
    mgr.register('1', action);

    const e = new KeyboardEvent('keydown', { key: '&', code: 'Digit1', bubbles: true });
    mgr.handleKeyDown(e);

    expect(action).toHaveBeenCalledTimes(1);
  });
});
