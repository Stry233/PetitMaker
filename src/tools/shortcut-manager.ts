/**
 * Keyboard shortcut manager.
 * Registers key combos (e.g. "t", "ctrl+z", "ctrl+shift+z") and fires
 * the associated action when the matching KeyboardEvent arrives.
 */

import { anyOverlayOpen } from '../core/runtime/overlay-state';
import { eventKeyToken } from '../core/runtime/key-token';

interface Binding {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  action: () => void;
}

/** Tags whose focused state should suppress shortcut handling. */
const IGNORED_TARGETS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function parseCombo(combo: string): { key: string; ctrl: boolean; shift: boolean; alt: boolean } {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  const ctrl = parts.includes('ctrl');
  const shift = parts.includes('shift');
  const alt = parts.includes('alt');
  return { key, ctrl, shift, alt };
}

// eventKeyToken lives in core/runtime/key-token so the engine, the chord recorder and the
// held-modifier tracker share ONE definition of "which key is this"; re-exported here for callers
// that already deal with this module.
export { eventKeyToken };

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
   * Ignores events when the target is an INPUT, TEXTAREA, or SELECT.
   */
  handleKeyDown(e: KeyboardEvent): void {
    if (anyOverlayOpen()) return; // a modal owns the foreground — tool shortcuts are suppressed
    const target = e.target as HTMLElement | null;
    if (target && (IGNORED_TARGETS.has(target.tagName) || target.isContentEditable)) return;

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
