/*
 * The keymap store: the user's overrides over the registry, persisted under the `keybinds` pref.
 */
import { create } from 'zustand';
import { readPref, writePref } from '../../platform/storage/prefs';
import { normalizeCombo } from '../../platform/input/combo';
import { COMMAND_META, KEYMAP_REVISION, META_BY_ID, PRESETS, UI_ZOOM_IDS, comboBindable, withCurrentIds } from './registry';
import { bindingIndex, effectiveCombo, overridesFor, uiZoomVariantCombos, type Overrides } from './resolve';
import { TOOLBAR_CONTEXTS, type ToolbarContext } from './toolbar';

interface RebindResult { ok: boolean; displaced?: string; reason?: 'reserved-combo' | 'unbindable-key' }

function load(): Overrides {
  try {
    const raw = readPref('keybinds');
    const o = raw ? JSON.parse(raw) : {};
    if (!o || typeof o !== 'object') return {};
    const loaded = withCurrentIds(o as Overrides);
    const revision = raw ? readPref('keybindsRevision') : KEYMAP_REVISION;
    const migrated = withLaterCommands(withFrozenDelete(loaded), revision);
    if (migrated !== loaded || revision < KEYMAP_REVISION) persist(migrated);
    return migrated;
  } catch { return {}; }
}

/** Delete was the shipped key of `selection.delete` before R took it. A keymap that puts the
 *  rectangle tool on R and says nothing of delete (the Pro preset as applied then) gets Delete
 *  written out, so R keeps meaning the rectangle and the keymap reads as Pro. Idempotent: once
 *  `selection.delete` has an entry, nothing changes. */
function withFrozenDelete(o: Overrides): Overrides {
  if (o['tool.rect'] !== 'r' || 'selection.delete' in o) return o;
  return { ...o, 'selection.delete': 'delete' };
}
/** The normalized combo `o` stores for `id`: undefined for none, null for unbound. */
const entryOf = (o: Overrides, id: string): string | null | undefined =>
  !(id in o) ? undefined : o[id] == null ? null : normalizeCombo(o[id]!);

/** A keymap saved at `revision` given the commands that joined the registry since: where what it
 *  stores of the commands it knew is exactly a shortcut style's, each later command takes that
 *  style's key unless one of those commands already answers it, and is left unbound otherwise, so
 *  the keymap still reads as that style whenever it can. A keymap matching no style leaves later
 *  commands to their shipped keys, which `effectiveCombo` keeps off keys the user assigned. */
function withLaterCommands(o: Overrides, revision: number): Overrides {
  const later = COMMAND_META.filter((c) => (c.since ?? 0) > revision);
  if (later.length === 0) return o;
  const known = COMMAND_META.filter((c) => (c.since ?? 0) <= revision);
  for (const preset of PRESETS) {
    const expected = overridesFor(preset.binds);
    if (!known.every((c) => entryOf(o, c.id) === entryOf(expected, c.id))) continue;
    const used = new Set(TOOLBAR_CONTEXTS.flatMap((context) => known.flatMap((c) => {
      const combo = effectiveCombo(o, c.id, context);
      return combo ? [normalizeCombo(combo)] : [];
    })));
    const out: Overrides = { ...o };
    for (const c of later) {
      const key = entryOf(expected, c.id);
      if (key === undefined) continue;
      out[c.id] = key !== null && used.has(key) ? null : key;
    }
    return out;
  }
  return o;
}

function persist(o: Overrides): void {
  writePref('keybinds', JSON.stringify(o));
  writePref('keybindsRevision', KEYMAP_REVISION);
}

interface KeybindStore {
  overrides: Overrides;
  /** Assign `combo` to `id`, stealing it from any current holder (which becomes unbound). Returns
   *  the displaced command id when a steal happened. Refuses a key the browser or the system takes
   *  (`registry.ts:UNBINDABLE_KEYS`) and a shifted twin of a live UI-zoom binding
   *  (`uiZoomVariantCombos`), which the zoom listener would answer alongside it. */
  rebind: (id: string, combo: string, context?: ToolbarContext) => RebindResult;
  /** Explicitly unbind a command (override = null). */
  clear: (id: string) => void;
  /** Return one command to its shipped combo in `context`, through `rebind` so a holder of that
   *  combo is displaced; a command shipped unbound is cleared. */
  restoreDefault: (id: string, context?: ToolbarContext) => void;
  /** Replace the entire keymap from a binds map (id → combo|null). Commands absent from `binds` fall
   *  back to their default; a combo equal to the default stores no override. Used by preset-apply +
   *  JSON import (the caller validates uniqueness first). */
  applyBinds: (binds: Record<string, string | null>, exactOverrides?: Overrides) => void;
  /** Drop every user override (back to shipped defaults). */
  resetAll: () => void;
  /** Whether the shortcuts window is taking the next chord for a command, which no other key
   *  handler may answer meanwhile. */
  recording: boolean;
  setRecording: (on: boolean) => void;
}

export const useKeybinds = create<KeybindStore>((set, get) => ({
  overrides: load(),
  recording: false,
  setRecording: (on) => set((s) => (s.recording === on ? s : { recording: on })),
  rebind: (id, combo, context) => {
    const cmd = META_BY_ID.get(id);
    const n = normalizeCombo(combo);
    if (!cmd || !n) return { ok: false };
    if (!comboBindable(n)) return { ok: false, reason: 'unbindable-key' };
    // A zoom command may sit on its own twin (moving the pair around is what a rebind of it means);
    // anything else landing there would fire together with the zoom.
    if (!UI_ZOOM_IDS.includes(id) && uiZoomVariantCombos(get().overrides).has(n)) {
      return { ok: false, reason: 'reserved-combo' };
    }
    const next: Overrides = { ...get().overrides };
    let displaced: string | undefined;
    const defaultCombo = effectiveCombo({}, id, context);
    if (defaultCombo && normalizeCombo(defaultCombo) === n) delete next[id];
    else next[id] = n;
    // A custom binding applies in every available toolbar, including ones not currently shown.
    const own = id in next ? { [id]: next[id]! } : {};
    for (const scope of TOOLBAR_CONTEXTS) {
      const target = effectiveCombo(own, id, scope);
      if (!target) continue;
      for (const [combo, holder] of bindingIndex(get().overrides, scope)) {
        if (combo === normalizeCombo(target) && holder !== id) { next[holder] = null; displaced = holder; }
      }
    }
    set({ overrides: next }); persist(next);
    return { ok: true, displaced };
  },
  clear: (id) => {
    if (!META_BY_ID.has(id)) return;
    const next: Overrides = { ...get().overrides, [id]: null };
    set({ overrides: next }); persist(next);
  },
  restoreDefault: (id, context) => {
    const defaults = effectiveCombo({}, id, context);
    if (defaults) get().rebind(id, defaults, context);
    else get().clear(id);
  },
  applyBinds: (binds, exactOverrides) => {
    if (exactOverrides) { set({ overrides: { ...exactOverrides } }); persist(exactOverrides); return; }
    const next = overridesFor(binds);
    set({ overrides: next }); persist(next);
  },
  resetAll: () => { set({ overrides: {} }); persist({}); },
}));
