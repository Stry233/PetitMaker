/**
 * eventKeyToken is the ONE KeyboardEvent→token map shared by the shortcut engine, the chord
 * recorder and the held-modifier tracker. The default keymap binds tools to the top-row digits
 * ('1'..'8'), but on AZERTY (and other non-QWERTY layouts) the unshifted digit row types a
 * symbol, not the digit (French Digit1 → '&'), so those bindings would never fire without a
 * physical-row fallback. Letters are deliberately excluded (WASD-style bindings follow the
 * layout's own keycap), and a shifted digit combo stays character-based.
 */
import { describe, it, expect, vi } from 'vitest';
import { eventKeyToken } from '../../core/runtime/key-token';
import { ShortcutManager } from '../../tools/shortcut-manager';

const ev = (init: Partial<KeyboardEvent>): KeyboardEvent => init as KeyboardEvent;

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
