/**
 * The keyboard dispatch engine: a combo string in, the bound action fired.
 *
 * The third of the three keyboard pieces: `state/keymap/` holds the keymap data, `editor/commands/commands.ts`
 * holds what each command does, and this holds the match. It knows nothing about tools, so a shell
 * wires whatever it likes to whatever combo.
 */

import { anyOverlayOpen } from '../channels/overlay-state';
import { eventKeyToken } from './key-token';
import { splitCombo } from './combo';
import { isTextEntry } from './text-entry';

interface Binding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  action: () => void;
  /** Leave the key's default to the browser (a clipboard key, whose event must still fire). */
  keepDefault: boolean;
}

export class ShortcutManager {
  private bindings: Binding[] = [];

  /**
   * Register a keyboard shortcut.
   * @param combo  Key combo string, e.g. "t", "ctrl+z", "ctrl+shift+z"
   * @param action Callback to invoke when the combo is matched.
   * @param keepDefault Leave the key's default action to the browser.
   */
  register(combo: string, action: () => void, keepDefault = false): void {
    const { key, ctrl, shift, alt } = splitCombo(combo);
    this.bindings.push({ key, ctrl, shift, alt, action, keepDefault });
  }

  /**
   * Handle a keydown event: match against registered bindings and fire
   * the action if a match is found. Calls e.preventDefault() on match, unless the binding keeps it.
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
        if (!binding.keepDefault) e.preventDefault();
        binding.action();
        return;
      }
    }
  }
}
