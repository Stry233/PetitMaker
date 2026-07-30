/**
 * modifier-state — a module-level singleton tracking held modifier keys, like
 * render-scheduler / motion-state. The shape brushes (line, rect, circle) read
 * the CONSTRAIN key to constrain a drag: it snaps a line to horizontal /
 * vertical / 45-degree diagonal, and a rect / circle to a perfect square /
 * round circle. The constrain key defaults to Shift but is user-rebindable on
 * the keyboard page (setConstrainKey); when it's a non-modifier key we track it
 * in a held-token set.
 *
 * A global keydown/keyup tracker (installed once) is used rather than threading
 * the modifier through every pointer call, so a key pressed or released MID-drag
 * is always reflected, and both the paint brushes and the region brush share it.
 *
 * The multi-select key (turns a click into a membership toggle, a drag into a rubber band) is
 * tracked the same way, mirroring the constrain key: a dedicated boolean for its default modifier
 * (ctrlHeld, alongside shiftHeld) plus the shared heldTokens set for a rebound key.
 */
import { eventKeyToken } from './key-token';

let shiftHeld = false;
let ctrlHeld = false;
let spaceHeld = false;
let installed = false;
/** The user's chosen constrain key token ('shift' by default). */
let constrainKey = 'shift';
/** The user's chosen multi-select key token ('ctrl' by default). */
let multiSelectKey = 'ctrl';
/** Currently-held non-modifier key tokens (for a rebound constrain/multi-select key). */
const heldTokens = new Set<string>();

/** Install the window keydown/keyup listeners once (idempotent, browser-only). */
export function installModifierTracking(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const sync = (e: KeyboardEvent) => {
    shiftHeld = e.shiftKey;
    // Cmd counts as Ctrl, matching what ShortcutManager already does for every `ctrl+*` binding:
    // on macOS Ctrl+click IS the secondary click, opening context menus rather than multi-selecting.
    ctrlHeld = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') spaceHeld = e.type === 'keydown';
    const tok = eventKeyToken(e);
    if (e.type === 'keydown') heldTokens.add(tok);
    else heldTokens.delete(tok);
  };
  window.addEventListener('keydown', sync, { passive: true });
  window.addEventListener('keyup', sync, { passive: true });
  // a window blur can swallow the keyup (e.g. alt-tab), so clear on blur — a modifier stuck on
  // would silently turn every later click into a toggle / drag into a rubber band.
  window.addEventListener('blur', () => { shiftHeld = false; ctrlHeld = false; spaceHeld = false; heldTokens.clear(); }, { passive: true });
}

export function isShiftHeld(): boolean {
  return shiftHeld;
}

/** Set which key constrains shape drags (from the keybind store; 'shift' = default, '' = disabled). */
export function setConstrainKey(token: string): void {
  constrainKey = token;
}

/** Whether the (possibly rebound) constrain key is currently held. The shape tools read THIS, not
 *  isShiftHeld, so a user-remapped constrain key takes effect. */
export function isConstrainHeld(): boolean {
  return constrainKey === 'shift' ? shiftHeld : heldTokens.has(constrainKey);
}

/** Space held: the pointer machine turns a left-drag into a camera pan in any
 *  tool mode — the standard navigate-while-drawing escape hatch. */
export function isSpaceHeld(): boolean {
  return spaceHeld;
}

/** Set which key drives multi-select (from the keybind store; 'ctrl' = default, '' = disabled). */
export function setMultiSelectKey(token: string): void {
  multiSelectKey = token;
}

/** Whether the (possibly rebound) multi-select key is currently held. The pointer machine reads
 *  THIS, not a raw ctrlKey check, so a user-remapped multi-select key takes effect. */
export function isMultiSelectHeld(): boolean {
  return multiSelectKey === 'ctrl' ? ctrlHeld : heldTokens.has(multiSelectKey);
}
