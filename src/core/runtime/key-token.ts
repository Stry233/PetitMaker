/*
 * key-token — the ONE map from a KeyboardEvent to the canonical key token a combo string ends with.
 * Shared by the shortcut engine (tools/shortcut-manager), the chord recorder (ui/chrome/keyboard),
 * and the held-modifier tracker (core/runtime/modifier-state), so they can never disagree on what
 * key a physical press represents. Numpad keys map to `num0`…`num9` / `numadd` … via `event.code`
 * so they bind INDEPENDENTLY of the top-row digits (which share `event.key`). Space → `space`.
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
  return e.key === ' ' ? 'space' : e.key.toLowerCase();
}
