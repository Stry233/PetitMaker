/*
 * The user-override layer over the command registry (persisted to localStorage). Effective binding
 * of a command = its user override (incl. an explicit null = "unbound") else the registry default.
 * Reserved commands ignore overrides. Rebinding STEALS the combo from any prior holder (which becomes
 * unbound) so a combo maps to exactly one command. All resolution is pure so it unit-tests cleanly.
 */
import { create } from 'zustand';
import { COMMANDS, COMMAND_BY_ID, ALIASES } from './commands';

const LS_KEY = 'petit-planet-keybinds';

export type Overrides = Record<string, string | null>;

/** Canonical combo string: modifiers in a fixed order (ctrl, alt, shift), then the key, lowercase.
 *  So "Shift+G", "shift+g", "G+Shift" all normalize to "shift+g". */
export function normalizeCombo(combo: string): string {
  let ctrl = false, alt = false, shift = false, key = '';
  for (const raw of combo.toLowerCase().split('+')) {
    const p = raw.trim();
    if (!p) continue;
    if (p === 'ctrl' || p === 'cmd' || p === 'meta' || p === 'control') ctrl = true;
    else if (p === 'alt' || p === 'option') alt = true;
    else if (p === 'shift') shift = true;
    else key = p;
  }
  const out: string[] = [];
  if (ctrl) out.push('ctrl');
  if (alt) out.push('alt');
  if (shift) out.push('shift');
  if (key) out.push(key);
  return out.join('+');
}

/** Effective combo for a command: an explicit override (incl. null=unbound) wins, else the registry
 *  default. Reserved commands always return their default (overrides can't touch them). */
export function effectiveCombo(overrides: Overrides, id: string): string | null {
  const cmd = COMMAND_BY_ID.get(id);
  if (!cmd) return null;
  if (cmd.reserved) return cmd.defaultCombo;
  return id in overrides ? overrides[id]! : cmd.defaultCombo;
}

/** normalized combo → command id, for every command with a (non-null) effective binding. */
export function bindingIndex(overrides: Overrides): Map<string, string> {
  const m = new Map<string, string>();
  for (const cmd of COMMANDS) {
    const combo = effectiveCombo(overrides, cmd.id);
    if (combo) m.set(normalizeCombo(combo), cmd.id);
  }
  return m;
}

/** normalized combo → command id for the FIXED aliases (arrows→pan, ctrl+y→redo, backspace→delete).
 *  The keyboard page falls back to this so alias keys still SHOW their command (they aren't in the
 *  editable bindingIndex). Static — aliases don't change with user overrides. */
export function aliasIndex(): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of ALIASES) m.set(normalizeCombo(a.combo), a.commandId);
  return m;
}

/** True if `combo` is a reserved command's default (undo/redo) — never stealable/bindable. */
export function isReservedCombo(combo: string): boolean {
  const n = normalizeCombo(combo);
  return COMMANDS.some((c) => c.reserved && c.defaultCombo && normalizeCombo(c.defaultCombo) === n);
}

export interface RebindResult { ok: boolean; displaced?: string; reason?: 'reserved-command' | 'reserved-combo' }

function load(): Overrides {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? (o as Overrides) : {};
  } catch { return {}; }
}
function persist(o: Overrides): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch { /* quota / private mode */ }
}

interface KeybindStore {
  overrides: Overrides;
  /** Assign `combo` to `id`, stealing it from any current holder (which becomes unbound). Returns
   *  the displaced command id when a steal happened. Refuses reserved commands + reserved combos. */
  rebind: (id: string, combo: string) => RebindResult;
  /** Explicitly unbind a command (override = null). */
  clear: (id: string) => void;
  /** Replace the ENTIRE keymap from a binds map (id → combo|null). Commands absent from `binds` fall
   *  back to their default; a combo equal to the default stores no override. Used by preset-apply +
   *  JSON import (the caller validates uniqueness first). Reserved commands are left untouched. */
  applyBinds: (binds: Record<string, string | null>) => void;
  /** Drop every user override (back to shipped defaults). */
  resetAll: () => void;
}

export const useKeybinds = create<KeybindStore>((set, get) => ({
  overrides: load(),
  rebind: (id, combo) => {
    const cmd = COMMAND_BY_ID.get(id);
    if (!cmd || cmd.reserved) return { ok: false, reason: 'reserved-command' };
    const n = normalizeCombo(combo);
    if (!n) return { ok: false, reason: 'reserved-combo' };
    if (isReservedCombo(n)) return { ok: false, reason: 'reserved-combo' };
    const next: Overrides = { ...get().overrides };
    let displaced: string | undefined;
    for (const [c, holderId] of bindingIndex(next)) {
      if (c === n && holderId !== id) { next[holderId] = null; displaced = holderId; }
    }
    // Assigning a command its own default → drop the override (stay on default) rather than store a
    // redundant one, so resetAll and "is-default" checks stay clean.
    if (cmd.defaultCombo && normalizeCombo(cmd.defaultCombo) === n) delete next[id];
    else next[id] = n;
    set({ overrides: next }); persist(next);
    return { ok: true, displaced };
  },
  clear: (id) => {
    const cmd = COMMAND_BY_ID.get(id);
    if (!cmd || cmd.reserved) return;
    const next: Overrides = { ...get().overrides, [id]: null };
    set({ overrides: next }); persist(next);
  },
  applyBinds: (binds) => {
    const next: Overrides = {};
    for (const cmd of COMMANDS) {
      if (cmd.reserved) continue;
      const desired = cmd.id in binds ? binds[cmd.id] : cmd.defaultCombo;
      const norm = desired == null ? null : normalizeCombo(desired);
      const defNorm = cmd.defaultCombo == null ? null : normalizeCombo(cmd.defaultCombo);
      if (norm !== defNorm) next[cmd.id] = norm; // else matches default → store no override
    }
    set({ overrides: next }); persist(next);
  },
  resetAll: () => { set({ overrides: {} }); persist({}); },
}));
