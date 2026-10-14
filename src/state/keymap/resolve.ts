/*
 * Keymap resolution: the effective binding of every command under the user's overrides.
 *
 * Effective binding of a command = its user override (incl. an explicit null = "unbound") else its
 * shipped default (`defaultCombo`: the toolbar table for a toolbar command, the registry row for the
 * rest). Every command is rebindable. Rebinding steals the combo from any prior holder
 * (which becomes unbound) so a combo maps to exactly one command. The one combo a rebind is refused
 * is a shifted twin of a live UI-zoom binding (`uiZoomVariantCombos`). All resolution is pure.
 */
import { eventKeyToken } from '../../platform/input/key-token';
import { joinCombo, normalizeCombo, splitCombo } from '../../platform/input/combo';
import { ALIASES, COMMAND_META, META_BY_ID, PRESETS, UI_ZOOM_IDS, type KeymapPreset } from './registry';
import { CONTEXT_FREE_TOOLBAR, TOOLBAR_CONTEXTS, toolbarDefault, type ToolbarContext } from './toolbar';

export type Overrides = Record<string, string | null>;

/** The shipped combo of command `id` in `context` (by default `CONTEXT_FREE_TOOLBAR`): the toolbar
 *  table's key for a toolbar command, null where that toolbar leaves it out; the registry row's for
 *  every other command. */
function defaultCombo(id: string, context: ToolbarContext = CONTEXT_FREE_TOOLBAR): string | null {
  const contextual = toolbarDefault(context, id);
  return contextual !== undefined ? contextual : META_BY_ID.get(id)?.defaultCombo ?? null;
}

/** Effective combo for a command in `context` (by default `CONTEXT_FREE_TOOLBAR`): none for a toolbar
 *  command that toolbar leaves out; else an explicit override (incl. null=unbound) wins, else the
 *  shipped default. */
export function effectiveCombo(overrides: Overrides, id: string, context: ToolbarContext = CONTEXT_FREE_TOOLBAR): string | null {
  if (!META_BY_ID.has(id)) return null;
  if (toolbarDefault(context, id) === null) return null;
  if (id in overrides) return overrides[id]!;
  const combo = defaultCombo(id, context);
  // A changed default must not take a key already assigned by the user.
  if (combo && Object.entries(overrides).some(([other, value]) => other !== id && META_BY_ID.has(other)
    && toolbarDefault(context, other) !== null
    && value != null && normalizeCombo(value) === normalizeCombo(combo))) return null;
  return combo;
}

/** normalized combo → command id, for every command with a (non-null) effective binding. */
export function bindingIndex(overrides: Overrides, context?: ToolbarContext): Map<string, string> {
  const m = new Map<string, string>();
  for (const cmd of COMMAND_META) {
    const combo = effectiveCombo(overrides, cmd.id, context);
    if (combo) m.set(normalizeCombo(combo), cmd.id);
  }
  return m;
}

/** normalized combo → command id for the fixed aliases (arrows→pan, ctrl+y→redo, backspace→delete).
 *  The keyboard page falls back to this so alias keys still show their command (they aren't in the
 *  editable bindingIndex). Static — aliases don't change with user overrides. */
export function aliasIndex(): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of ALIASES) m.set(normalizeCombo(a.combo), a.commandId);
  return m;
}

/* ── UI-zoom twins ───────────────────────────────────────────────────────────
 *
 * `=`/`+` and `-`/`_` share a keycap, so one physical press produces either character depending on
 * Shift, and the zoom listener answers both spellings of the key it is bound to. Two consequences
 * for the rest of the keymap: a command bound to a shifted twin of a live zoom binding would fire
 * alongside the zoom, and the bare `+` spelling cannot be expressed at all (`+` is normalizeCombo's
 * segment separator, so a combo ending in it collapses to no key and never reaches the index).
 */

const PLUS_KEYS = new Set(['=', '+']);
const MINUS_KEYS = new Set(['-', '_']);

/** The combos a live UI-zoom binding also answers, beside the binding itself: the shifted keycap of
 *  the key it sits on, and for `-`/`_` the other spelling of that keycap. A zoom binding on any
 *  other key has no twins and is matched exactly, so it contributes nothing here. Never contains
 *  the base combos — those are ordinary bindings and stealing one is an ordinary steal. */
export function uiZoomVariantCombos(overrides: Overrides): Set<string> {
  const bases = new Set<string>();
  const variants = new Set<string>();
  for (const id of UI_ZOOM_IDS) {
    const combo = effectiveCombo(overrides, id);
    if (!combo) continue;
    const { key, ctrl, alt } = splitCombo(combo);
    if (!key) continue;
    bases.add(normalizeCombo(combo));
    const twin = PLUS_KEYS.has(key) ? null : key === '-' ? '_' : key === '_' ? '-' : undefined;
    if (twin === undefined) continue; // an ordinary key: exact match only
    variants.add(joinCombo({ key, ctrl, alt, shift: true }));
    if (twin) {
      variants.add(joinCombo({ key: twin, ctrl, alt, shift: false }));
      variants.add(joinCombo({ key: twin, ctrl, alt, shift: true }));
    }
  }
  for (const b of bases) variants.delete(b);
  return variants;
}

/** Does this keydown press the given UI-zoom combo? Ctrl in the combo answers Ctrl or Cmd, and a
 *  combo on a shared keycap (`=`/`+`, `-`/`_`) answers either spelling regardless of Shift, since
 *  the same physical key reports both. Any other key matches its recorded token (`eventKeyToken`:
 *  numpad keys, Space and layout-independent digits), Shift included. */
export function matchesUiZoomCombo(
  combo: string | null,
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> & { code?: string },
): boolean {
  if (!combo) return false;
  const { key, ctrl, alt, shift } = splitCombo(combo);
  if (!key) return false;
  if (ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (alt !== e.altKey) return false;
  const pressed = e.key.toLowerCase();
  if (PLUS_KEYS.has(key)) return PLUS_KEYS.has(pressed);
  if (MINUS_KEYS.has(key)) return MINUS_KEYS.has(pressed);
  return eventKeyToken(e) === key && shift === e.shiftKey;
}

/** The overrides that make the effective keymap equal `binds` (id → combo|null): commands absent
 *  from `binds` keep their default, and a combo equal to the default stores no override. */
export function overridesFor(binds: Record<string, string | null>): Overrides {
  const next: Overrides = {};
  for (const cmd of COMMAND_META) {
    const shipped = defaultCombo(cmd.id);
    const desired = cmd.id in binds ? binds[cmd.id] : shipped;
    const norm = desired == null ? null : normalizeCombo(desired);
    const defNorm = shipped == null ? null : normalizeCombo(shipped);
    if (norm !== defNorm) next[cmd.id] = norm;
  }
  return next;
}

/** Full effective keymap under the current overrides. */
export function currentBinds(overrides: Overrides, context?: ToolbarContext): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const cmd of COMMAND_META) {
    const c = effectiveCombo(overrides, cmd.id, context);
    m.set(cmd.id, c == null ? null : normalizeCombo(c));
  }
  return m;
}

/* A preset is a set of combos that differ from the shipped defaults; applying one replaces the
 * user overrides so the effective keymap matches it. `detectPreset` names the current keymap (or
 * 'custom' once hand-edited). */

/** Full effective keymap of a preset: every command → normalized combo|null. */
export function presetBinds(preset: KeymapPreset): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const cmd of COMMAND_META) {
    const raw = cmd.id in preset.binds ? preset.binds[cmd.id] : defaultCombo(cmd.id);
    m.set(cmd.id, raw == null ? null : normalizeCombo(raw));
  }
  return m;
}

function mapsEqual(a: Map<string, string | null>, b: Map<string, string | null>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Which preset the current overrides match, or 'custom'. */
export function detectPreset(overrides: Overrides): string {
  for (const preset of PRESETS) {
    const expected = overridesFor(preset.binds);
    if (TOOLBAR_CONTEXTS.every(context => mapsEqual(currentBinds(overrides, context), currentBinds(expected, context)))) return preset.id;
  }
  return 'custom';
}
