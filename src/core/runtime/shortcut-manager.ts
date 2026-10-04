/**
 * THE KEYBOARD DISPATCH ENGINE: a combo string in, the bound action fired.
 *
 * The third of the three keyboard pieces: `keybindings.ts` holds the keymap DATA, `kit/commands.ts`
 * holds what each command DOES, and this holds the match. It knows nothing about tools, so a shell
 * wires whatever it likes to whatever combo.
 */

import { anyOverlayOpen } from './overlay-state';
import { eventKeyToken } from './key-token';
import { isTextEntry } from './text-entry';

interface Binding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  action: () => void;
}

function parseCombo(combo: string): { key: string; ctrl: boolean; shift: boolean; alt: boolean } {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  const ctrl = parts.includes('ctrl');
  const shift = parts.includes('shift');
  const alt = parts.includes('alt');
  return { key, ctrl, shift, alt };
}

export class ShortcutManager {
  private bindings: Binding[] = [];

  /**
   * Register a keyboard shortcut.
   * @param combo  Key combo string, e.g. "t", "ctrl+z", "ctrl+shift+z"
   * @param action Callback to invoke when the combo is matched.
   */
  register(combo: string, action: () => void): void {
    const { key, ctrl, shift, alt } = parseCombo(combo);
    this.bindings.push({ key, ctrl, shift, alt, action });
  }

  /**
   * Handle a keydown event: match against registered bindings and fire
   * the action if a match is found. Calls e.preventDefault() on match.
   * Ignores events whose target is a form field or editable content.
   */
  handleKeyDown(e: KeyboardEvent): void {
    if (anyOverlayOpen()) return; // a modal owns the foreground — tool shortcuts are suppressed
    if (isTextEntry(e.target)) return;

    const pressedKey = eventKeyToken(e);

    for (const binding of this.bindings) {
      if (
        binding.key === pressedKey &&
        binding.ctrl === (e.ctrlKey || e.metaKey) &&
        binding.shift === e.shiftKey &&
        binding.alt === e.altKey
      ) {
        e.preventDefault();
        binding.action();
        return;
      }
    }
  }
}
