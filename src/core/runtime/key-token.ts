/*
 * key-token — the ONE map from a KeyboardEvent to the canonical key token a combo string ends with.
 * Shared by the shortcut engine (core/runtime/shortcut-manager), the chord recorder (ui/chrome/modals/keyboard),
 * and the held-modifier tracker (core/runtime/modifier-state), so they can never disagree on what
 * key a physical press represents. Numpad keys map to `num0`…`num9` / `numadd` … via `event.code`
 * so they bind INDEPENDENTLY of the top-row digits (which share `event.key`). Space → `space`.
 *
 * The top-row DIGITS fall back to `event.code` too, but only there: on AZERTY (and other
 * non-QWERTY layouts) the unshifted digit row types symbols, not digits (French Digit1 → '&'), so
 * a keymap default like '1'..'8' for the tool row would never fire. Letters stay character-based
 * (`event.key`) on purpose — WASD-style bindings are meant to follow the layout's own keycaps, not
 * the physical position — and a SHIFTED digit combo (shift+? etc.) stays character-based too, since
 * shift+digit is a punctuation combo the user is choosing by its glyph, not its row position.
 */
const NUMPAD_OP: Record<string, string> = {
  Add: 'numadd', Subtract: 'numsubtract', Multiply: 'nummultiply',
  Divide: 'numdivide', Decimal: 'numdecimal', Enter: 'numenter',
};

export function eventKeyToken(e: KeyboardEvent): string {
  const code = e.code || '';
  if (code.startsWith('Numpad')) {
    const rest = code.slice(6);
    if (rest.length === 1 && rest >= '0' && rest <= '9') return `num${rest}`;
    if (NUMPAD_OP[rest]) return NUMPAD_OP[rest];
  }
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
  if (!e.shiftKey && code.length === 6 && code.startsWith('Digit')) {
    const digit = code.slice(5);
    if (key !== digit) return digit;
  }
  return key;
}
