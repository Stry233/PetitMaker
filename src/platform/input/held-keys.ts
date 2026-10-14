/*
 * The keys held down right now, tracked by one window keydown/keyup listener pair so a key pressed
 * or released mid-drag is reflected without threading it through every pointer call. Readers ask
 * by binding token (`isKeyHeld('shift')`, `isKeyHeld('x')`); which command a key serves is the
 * keymap's business, not this module's.
 */
import { createSignal } from '../../core/base/signal';
import { eventKeyToken } from './key-token';

let shiftHeld = false;
let ctrlHeld = false;
let altHeld = false;
let spaceHeld = false;
/** Held non-modifier key tokens. */
const heldTokens = new Set<string>();
const changed = createSignal();
let uninstall: (() => void) | null = null;

/** Notified after every key press, release or window blur that the tracker records (key repeats
 *  excluded). Readers compare their own answer before and after. */
export function onHeldKeysChange(fn: () => void): () => void {
  return changed.subscribe(fn);
}

function clearAll(): void {
  shiftHeld = false; ctrlHeld = false; altHeld = false; spaceHeld = false; heldTokens.clear();
}

/** Install the window listeners once (idempotent, browser-only). */
export function installKeyTracking(): void {
  if (uninstall || typeof window === 'undefined') return;
  const sync = (e: KeyboardEvent) => {
    shiftHeld = e.shiftKey;
    // Cmd counts as Ctrl, matching the shortcut engine's reading of every `ctrl+*` binding: on
    // macOS Ctrl+click is the secondary click and opens context menus.
    ctrlHeld = e.ctrlKey || e.metaKey;
    altHeld = e.altKey;
    if (e.code === 'Space') spaceHeld = e.type === 'keydown';
    const tok = eventKeyToken(e);
    if (e.type === 'keydown') heldTokens.add(tok);
    else heldTokens.delete(tok);
    if (!e.repeat) changed.emit();
  };
  // A window blur can swallow the keyup (alt-tab), so blur releases everything: a modifier stuck on
  // would silently change what every later click means.
  const blur = () => { clearAll(); changed.emit(); };
  window.addEventListener('keydown', sync, { passive: true });
  window.addEventListener('keyup', sync, { passive: true });
  window.addEventListener('blur', blur, { passive: true });
  uninstall = () => {
    window.removeEventListener('keydown', sync);
    window.removeEventListener('keyup', sync);
    window.removeEventListener('blur', blur);
  };
}

/** Whether the key a binding token names is held. A modifier token reads the modifier's own flag
 *  (Cmd counts as Ctrl), since a modifier's keydown reports its name ('control', 'meta'), never
 *  the binding's token; any other key reads the held-token set. The empty token is never held. */
export function isKeyHeld(token: string): boolean {
  switch (token) {
    case 'shift': return shiftHeld;
    case 'ctrl': case 'control': case 'meta': case 'cmd': return ctrlHeld;
    case 'alt': case 'option': return altHeld;
    case 'space': return spaceHeld;
    default: return heldTokens.has(token);
  }
}

export function __resetHeldKeys(): void {
  uninstall?.();
  uninstall = null;
  clearAll();
}
