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
 * (ctrlHeld, alongside shiftHeld) plus the shared heldTokens set for a rebound key. So is the
 * break-handle key, which splits a curve anchor's direction line so its two sides turn apart, and
 * the pan-drag key, which turns a left drag into a camera pan in any tool mode.
 */
import { eventKeyToken } from './key-token';

let shiftHeld = false;
let ctrlHeld = false;
let altHeld = false;
let spaceHeld = false;
let installed = false;
/** The user's chosen constrain key token ('shift' by default). */
let constrainKey = 'shift';
/** The user's chosen multi-select key token ('ctrl' by default). */
let multiSelectKey = 'ctrl';
/** The user's chosen break-handle key token ('alt' by default). */
let breakHandleKey = 'alt';
/** The user's chosen pan-drag key token ('space' by default). */
let panDragKey = 'space';
/** Currently-held non-modifier key tokens (for a rebound constrain/multi-select key). */
const heldTokens = new Set<string>();
/** Notified when the multi-select key goes down or up — see `onMultiSelectChange`. */
const multiSelectListeners = new Set<() => void>();
const panDragListeners = new Set<() => void>();

/**
 * Subscribe to the multi-select key changing. Returns an unsubscribe.
 *
 * A key press runs with no pointer event beside it, so a reader that only recomputes on
 * pointer-move sees the new state one mouse-move late. The pointer machine uses this to
 * re-sample in place, the way it does for a camera move under a still cursor.
 */
export function onMultiSelectChange(fn: () => void): () => void {
  multiSelectListeners.add(fn);
  return () => { multiSelectListeners.delete(fn); };
}

/** Notify cursor consumers when the held pan key changes, including rebinding and window blur. */
export function onPanDragChange(fn: () => void): () => void {
  panDragListeners.add(fn);
  return () => { panDragListeners.delete(fn); };
}

/** Install the window keydown/keyup listeners once (idempotent, browser-only). */
export function installModifierTracking(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Key repeats leave the held state unchanged and need no cursor update.
  const announceIfChanged = (was: boolean, wasPan: boolean) => {
    if (isMultiSelectHeld() !== was) for (const fn of multiSelectListeners) fn();
    if (isPanDragHeld() !== wasPan) for (const fn of panDragListeners) fn();
  };
  const sync = (e: KeyboardEvent) => {
    const was = isMultiSelectHeld();
    const wasPan = isPanDragHeld();
    shiftHeld = e.shiftKey;
    // Cmd counts as Ctrl, matching what ShortcutManager already does for every `ctrl+*` binding:
    // on macOS Ctrl+click IS the secondary click, opening context menus rather than multi-selecting.
    ctrlHeld = e.ctrlKey || e.metaKey;
    altHeld = e.altKey;
    if (e.code === 'Space') spaceHeld = e.type === 'keydown';
    const tok = eventKeyToken(e);
    if (e.type === 'keydown') heldTokens.add(tok);
    else heldTokens.delete(tok);
    announceIfChanged(was, wasPan);
  };
  window.addEventListener('keydown', sync, { passive: true });
  window.addEventListener('keyup', sync, { passive: true });
  // a window blur can swallow the keyup (e.g. alt-tab), so clear on blur — a modifier stuck on
  // would silently turn every later click into a toggle / drag into a rubber band.
  window.addEventListener('blur', () => {
    const was = isMultiSelectHeld();
    const wasPan = isPanDragHeld();
    shiftHeld = false; ctrlHeld = false; altHeld = false; spaceHeld = false; heldTokens.clear();
    announceIfChanged(was, wasPan);
  }, { passive: true });
}

export function isShiftHeld(): boolean {
  return shiftHeld;
}

/** Set which key breaks a curve handle (from the keybind store; 'alt' = default, '' = disabled). */
export function setBreakHandleKey(token: string): void {
  breakHandleKey = token;
}

/** Whether the (possibly rebound) break-handle key is held. Read while a curve's direction knob is
 *  dragged: held, the two sides of the line turn apart instead of staying one straight tangent. */
export function isBreakHandleHeld(): boolean {
  return breakHandleKey === 'alt' ? altHeld : heldTokens.has(breakHandleKey);
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

/** Set which key turns a left drag into a camera pan (from the keybind store; 'space' = default,
 *  '' = disabled). */
export function setPanDragKey(token: string): void {
  const was = isPanDragHeld();
  panDragKey = token;
  if (isPanDragHeld() !== was) for (const fn of panDragListeners) fn();
}

/** Whether the (possibly rebound) pan-drag key is held. The pointer machine turns a left drag into
 *  a camera pan while it is: the navigate-while-drawing escape hatch, live in any tool mode. */
export function isPanDragHeld(): boolean {
  return panDragKey === 'space' ? spaceHeld : heldTokens.has(panDragKey);
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
