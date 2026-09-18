import { editionSupportsCommand } from './edition';
/*
 * The keymap DATA — every discrete keyboard operation's identity (id, category, label, default
 * combo, continuous), the user-override layer over it, keymap PRESETS ("shortcut styles"), and
 * JSON import/export of the effective keymap. What a command DOES lives one layer up, in
 * `kit/commands.ts`; the pointer machine's held-key pan loop
 * (canvas/interaction/use-view-shortcuts) only needs this half, so it sits here where `canvas` can
 * read it downward. Presets/import/export read only ids, categories and combos — never `run` — so
 * they belong beside the rest of the data rather than a layer up.
 *
 * Effective binding of a command = its user override (incl. an explicit null = "unbound") else the
 * registry default. EVERY command is rebindable. Rebinding STEALS the combo from any prior holder
 * (which becomes unbound) so a combo maps to exactly one command. The one combo a rebind is refused
 * is a shifted twin of a live UI-zoom binding (`uiZoomVariantCombos`). All resolution is pure so it
 * unit-tests cleanly.
 */
import { create } from 'zustand';
import { readPref, writePref } from './prefs';

export type CommandCategory =
  | 'surface' | 'tool' | 'brush' | 'layer' | 'selection' | 'camera' | 'view' | 'history' | 'app' | 'overlay';

export interface CommandMeta {
  id: string;
  category: CommandCategory;
  labelKey: string;
  defaultCombo: string | null;
  /** A HELD-key action (continuous pan), not a discrete one-shot. Shown + rebindable on the keyboard
   *  page, but the discrete engine (useEditorShortcuts) skips it — the held rAF loop in
   *  canvas/interaction/use-view-shortcuts reads its effective key instead. */
  continuous?: boolean;
}

/* ── the registry ────────────────────────────────────────────────────────── */

const ALL_COMMAND_META: readonly CommandMeta[] = [
  // Build surface (opens the Build panel on that surface)
  { id: 'surface.mountain', category: 'surface', labelKey: 'menu.build_mountain', defaultCombo: null },
  { id: 'surface.river',    category: 'surface', labelKey: 'menu.build_river',    defaultCombo: null },
  { id: 'surface.road',     category: 'surface', labelKey: 'menu.build_road',     defaultCombo: null },

  // Tools
  { id: 'tool.move',    category: 'tool', labelKey: 'menu.move',           defaultCombo: null },
  // Primary tools occupy 1–4; 5 cycles their shared shapes.
  { id: 'tool.brush',   category: 'tool', labelKey: 'terrain.brush',       defaultCombo: '1' },
  { id: 'tool.eraser',  category: 'tool', labelKey: 'design.eraser',       defaultCombo: '2' },
  { id: 'tool.edgecut', category: 'tool', labelKey: 'design.edge_cut',     defaultCombo: '3' },
  { id: 'tool.smart',   category: 'tool', labelKey: 'smart.build',         defaultCombo: '4' },
  { id: 'tool.shape_cycle', category: 'tool', labelKey: 'terrain.shapes', defaultCombo: '5' },
  { id: 'tool.free',    category: 'tool', labelKey: 'terrain.shape.free',  defaultCombo: null },
  { id: 'tool.line',    category: 'tool', labelKey: 'eraser.line',         defaultCombo: null },
  { id: 'tool.curve',   category: 'tool', labelKey: 'eraser.curve',        defaultCombo: null },
  { id: 'tool.rect',    category: 'tool', labelKey: 'eraser.rect',         defaultCombo: null },
  { id: 'tool.circle',  category: 'tool', labelKey: 'eraser.circle',       defaultCombo: null },
  { id: 'tool.auto_trim', category: 'tool', labelKey: 'edgecut.auto',      defaultCombo: 'q' },

  // Shape-drag constrain (HELD): snaps line/rect/circle drags to straight/square/round. Default
  // Shift, rebindable. Continuous — the shape tools read modifier-state.isConstrainHeld. Its key
  // drives setConstrainKey (see useEditorShortcuts).
  { id: 'tool.constrain', category: 'tool', labelKey: 'shortcut.shape_constrain', defaultCombo: 'shift', continuous: true },

  // Curve handle break (HELD): dragging one end of an anchor's direction line turns the other with
  // it; held, the two sides turn apart. Continuous — CurveHandles reads modifier-state.isBreakHandleHeld.
  { id: 'tool.break_handle', category: 'tool', labelKey: 'shortcut.break_handle', defaultCombo: 'alt', continuous: true },

  // Brush size + active layer
  { id: 'brush.bigger',  category: 'brush', labelKey: 'a11y.brush_increase', defaultCombo: null },
  { id: 'brush.smaller', category: 'brush', labelKey: 'a11y.brush_decrease', defaultCombo: null },
  { id: 'layer.up',      category: 'layer', labelKey: 'shortcut.layer_up',   defaultCombo: null },
  { id: 'layer.down',    category: 'layer', labelKey: 'shortcut.layer_down', defaultCombo: null },

  // Selection
  { id: 'selection.rotate_cw',  category: 'selection', labelKey: 'shortcut.rotate_cw',  defaultCombo: 'e' },
  { id: 'selection.rotate_ccw', category: 'selection', labelKey: 'shortcut.rotate_ccw', defaultCombo: null },
  { id: 'selection.delete',     category: 'selection', labelKey: 'shortcut.delete',     defaultCombo: 'delete' },
  { id: 'selection.deselect',   category: 'selection', labelKey: 'shortcut.deselect',   defaultCombo: 'escape' },

  // Multi-select (HELD): Ctrl turns a click into a membership toggle and a drag into a rubber
  // band. Continuous, so the pointer machine reads `modifier-state.isMultiSelectHeld` and the
  // discrete engine skips it. Declared here to be listed in the keyboard modal and rebindable.
  { id: 'selection.multi', category: 'selection', labelKey: 'shortcut.multi_select', defaultCombo: 'ctrl', continuous: true },
  { id: 'selection.all',   category: 'selection', labelKey: 'shortcut.select_all',   defaultCombo: 'ctrl+a' },

  // Camera / view
  { id: 'camera.zoom_in',  category: 'camera', labelKey: 'shortcut.zoom_in',  defaultCombo: null },
  { id: 'camera.zoom_out', category: 'camera', labelKey: 'shortcut.zoom_out', defaultCombo: null },
  { id: 'camera.fit',      category: 'camera', labelKey: 'a11y.fit_view',     defaultCombo: 'ctrl+0' },

  // Continuous camera pan (HELD keys) — the rAF loop in use-view-shortcuts reads these keys.
  // Rebindable + shown on the keyboard page.
  { id: 'camera.pan_up',    category: 'camera', labelKey: 'kbd.pan_up',    defaultCombo: 'w', continuous: true },
  { id: 'camera.pan_left',  category: 'camera', labelKey: 'kbd.pan_left',  defaultCombo: 'a', continuous: true },
  { id: 'camera.pan_down',  category: 'camera', labelKey: 'kbd.pan_down',  defaultCombo: 's', continuous: true },
  { id: 'camera.pan_right', category: 'camera', labelKey: 'kbd.pan_right', defaultCombo: 'd', continuous: true },

  // Held: a left drag pans the camera while this is down, in ANY tool mode, so a brush never has to
  // fight the camera. Continuous, so the pointer machine reads `modifier-state.isPanDragHeld`.
  { id: 'camera.pan_drag', category: 'camera', labelKey: 'shortcut.pan_drag', defaultCombo: 'space', continuous: true },
  { id: 'view.toggle',     category: 'view',   labelKey: 'shortcut.toggle_view', defaultCombo: '`' },

  // History. While painting a Generate region, undo/redo pop the region stroke instead of a map edit
  // (see kit/commands.ts's CommandContext); that reroute keys off the COMMAND, so it follows a
  // rebind to whatever combo these end up on.
  { id: 'history.undo', category: 'history', labelKey: 'shortcut.undo', defaultCombo: 'ctrl+z' },
  { id: 'history.redo', category: 'history', labelKey: 'shortcut.redo', defaultCombo: 'ctrl+shift+z' },

  // App actions
  { id: 'app.generate', category: 'app', labelKey: 'menu.generate', defaultCombo: 'ctrl+g' },
  // Ctrl+N belongs to the browser (new window) and preventDefault does not reach it, so the editor
  // asks for the modifier the browser has left alone rather than binding a key that never arrives.
  { id: 'app.new', category: 'app', labelKey: 'modal.new_title', defaultCombo: 'ctrl+alt+n' },
  // The two exports on the keys their output matches: the save file goes on Save, the picture on
  // Print. Both shadow a browser binding, which the engine's preventDefault takes care of on a
  // match — so unbinding either here hands that key back to the browser, as it should.
  { id: 'app.export_json',  category: 'app', labelKey: 'menu.export', defaultCombo: 'ctrl+s' },
  { id: 'app.export_image', category: 'app', labelKey: 'menu.image',  defaultCombo: 'ctrl+p' },
  { id: 'app.help', category: 'app', labelKey: 'menu.help', defaultCombo: null },
  { id: 'app.menu',  category: 'app', labelKey: 'shortcut.toggle_menu', defaultCombo: null },

  // UI scale (the chrome, not the map). Carried out by the always-live listener
  // (canvas/interaction/use-view-shortcuts.ts:useUiZoomShortcut), which reads these two effective
  // combos and so follows a rebind, and which keeps working behind an open modal. No RUN body: the
  // discrete engine skips these ids, the listener answers them.
  { id: 'app.ui_zoom_in',  category: 'app', labelKey: 'shortcut.ui_zoom_in',  defaultCombo: 'ctrl+=' },
  { id: 'app.ui_zoom_out', category: 'app', labelKey: 'shortcut.ui_zoom_out', defaultCombo: 'ctrl+-' },

  // Overlay toggles
  { id: 'overlay.grid',    category: 'overlay', labelKey: 'shortcut.toggle_grid',      defaultCombo: null },
  { id: 'overlay.numbers', category: 'overlay', labelKey: 'a11y.toggle_layer_numbers', defaultCombo: null },
  { id: 'overlay.chunks',  category: 'overlay', labelKey: 'shortcut.toggle_chunks',    defaultCombo: null },
];

export const COMMAND_META: readonly CommandMeta[] = ALL_COMMAND_META.filter(c => editionSupportsCommand(c.id));

export const META_BY_ID: ReadonlyMap<string, CommandMeta> = new Map(COMMAND_META.map((c) => [c.id, c]));

/** Fixed secondary bindings — a command has ONE registry combo, but the engine also wires these
 *  aliases so conventional alternates work. Not shown as separate rows / not user-editable. */
export const ALIASES: { combo: string; commandId: string }[] = [
  { combo: 'ctrl+y',    commandId: 'history.redo' },      // Windows-muscle-memory redo
  { combo: 'backspace', commandId: 'selection.delete' },  // Mac laptops' "Delete" key
  // Arrow keys pan alongside WASD (the arrows are the secondary binding; WASD is the editable
  // primary). Listed here so they SHOW on the keyboard + drive the held-pan loop from one source.
  { combo: 'arrowup',    commandId: 'camera.pan_up' },
  { combo: 'arrowdown',  commandId: 'camera.pan_down' },
  { combo: 'arrowleft',  commandId: 'camera.pan_left' },
  { combo: 'arrowright', commandId: 'camera.pan_right' },
];

/** The two commands the always-live UI-zoom listener carries out. */
export const UI_ZOOM_IDS: readonly string[] = ['app.ui_zoom_in', 'app.ui_zoom_out'];

/* ── user overrides ──────────────────────────────────────────────────────── */

export type Overrides = Record<string, string | null>;

/** `normalizeCombo`'s output rendered for a reader: "ctrl+shift+z" → "Ctrl Shift Z". Lives beside
 *  the grammar it reads, so the keyboard page, the bars and the hint panel all format one way. */
export function prettyCombo(combo: string | null): string {
  if (!combo) return '';
  return combo.split('+').map((p) => {
    if (p === 'ctrl') return 'Ctrl';
    if (p === 'alt') return 'Alt';
    if (p === 'shift') return 'Shift';
    if (p === 'escape') return 'Esc';
    if (p === 'backspace') return '⌫';
    if (p === 'delete') return 'Del';
    if (p === 'space') return 'Space';
    const NAMED: Record<string, string> = {
      printscreen: 'PrtSc', scrolllock: 'ScrLk', pause: 'Pause', insert: 'Ins',
      home: 'Home', pageup: 'PgUp', pagedown: 'PgDn', end: 'End',
      arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
    };
    if (NAMED[p]) return NAMED[p];
    if (p.startsWith('arrow')) return p.slice(5).replace(/^\w/, (c) => c.toUpperCase());
    if (p.startsWith('num')) {
      const r = p.slice(3);
      const op: Record<string, string> = { add: '+', subtract: '−', multiply: '×', divide: '÷', decimal: '.', enter: '⏎' };
      return `Num ${op[r] ?? r}`;
    }
    return p.toUpperCase();
  }).join(' ');
}

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

/** A normalized combo taken apart: modifier flags plus the key it ends on ('' for a bare-modifier
 *  combo like `ctrl`, which carries no key of its own). */
function splitCombo(combo: string): { key: string; ctrl: boolean; alt: boolean; shift: boolean } {
  const parts = normalizeCombo(combo).split('+');
  const last = parts[parts.length - 1] ?? '';
  const isMod = last === 'ctrl' || last === 'alt' || last === 'shift';
  return {
    key: isMod ? '' : last,
    ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift'),
  };
}

function joinCombo(key: string, ctrl: boolean, alt: boolean, shift: boolean): string {
  const out: string[] = [];
  if (ctrl) out.push('ctrl');
  if (alt) out.push('alt');
  if (shift) out.push('shift');
  out.push(key);
  return out.join('+');
}

/** Effective combo for a command: an explicit override (incl. null=unbound) wins, else the registry
 *  default. */
export function effectiveCombo(overrides: Overrides, id: string): string | null {
  const cmd = META_BY_ID.get(id);
  if (!cmd) return null;
  if (id in overrides) return overrides[id]!;
  const combo = cmd.defaultCombo;
  // A changed default must not take a key already assigned by the user.
  if (combo && Object.entries(overrides).some(([other, value]) => other !== id && META_BY_ID.has(other)
    && value != null && normalizeCombo(value) === normalizeCombo(combo))) return null;
  return combo;
}

/** normalized combo → command id, for every command with a (non-null) effective binding. */
export function bindingIndex(overrides: Overrides): Map<string, string> {
  const m = new Map<string, string>();
  for (const cmd of COMMAND_META) {
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

/** The combos a live UI-zoom binding also answers, BESIDE the binding itself: the shifted keycap of
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
    variants.add(joinCombo(key, ctrl, alt, true));
    if (twin) {
      variants.add(joinCombo(twin, ctrl, alt, false));
      variants.add(joinCombo(twin, ctrl, alt, true));
    }
  }
  for (const b of bases) variants.delete(b);
  return variants;
}

/** Does this keydown press the given UI-zoom combo? Ctrl in the combo answers Ctrl OR Cmd, and a
 *  combo on a shared keycap (`=`/`+`, `-`/`_`) answers either spelling regardless of Shift, since
 *  the same physical key reports both. Any other key matches exactly, Shift included. */
export function matchesUiZoomCombo(
  combo: string | null,
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): boolean {
  if (!combo) return false;
  const { key, ctrl, alt, shift } = splitCombo(combo);
  if (!key) return false;
  if (ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (alt !== e.altKey) return false;
  const pressed = e.key.toLowerCase();
  if (PLUS_KEYS.has(key)) return PLUS_KEYS.has(pressed);
  if (MINUS_KEYS.has(key)) return MINUS_KEYS.has(pressed);
  return pressed === key && shift === e.shiftKey;
}

export interface RebindResult { ok: boolean; displaced?: string; reason?: 'reserved-combo' }

function load(): Overrides {
  try {
    const raw = readPref('keybinds');
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? (o as Overrides) : {};
  } catch { return {}; }
}
function persist(o: Overrides): void {
  writePref('keybinds', JSON.stringify(o));
}

interface KeybindStore {
  overrides: Overrides;
  /** Assign `combo` to `id`, stealing it from any current holder (which becomes unbound). Returns
   *  the displaced command id when a steal happened. Refuses a shifted twin of a live UI-zoom
   *  binding (`uiZoomVariantCombos`), which the zoom listener would answer alongside it. */
  rebind: (id: string, combo: string) => RebindResult;
  /** Explicitly unbind a command (override = null). */
  clear: (id: string) => void;
  /** Replace the ENTIRE keymap from a binds map (id → combo|null). Commands absent from `binds` fall
   *  back to their default; a combo equal to the default stores no override. Used by preset-apply +
   *  JSON import (the caller validates uniqueness first). */
  applyBinds: (binds: Record<string, string | null>) => void;
  /** Drop every user override (back to shipped defaults). */
  resetAll: () => void;
}

export const useKeybinds = create<KeybindStore>((set, get) => ({
  overrides: load(),
  rebind: (id, combo) => {
    const cmd = META_BY_ID.get(id);
    const n = normalizeCombo(combo);
    if (!cmd || !n) return { ok: false };
    // A zoom command may sit on its own twin (moving the pair around is what a rebind of it means);
    // anything else landing there would fire together with the zoom.
    if (!UI_ZOOM_IDS.includes(id) && uiZoomVariantCombos(get().overrides).has(n)) {
      return { ok: false, reason: 'reserved-combo' };
    }
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
    if (!META_BY_ID.has(id)) return;
    const next: Overrides = { ...get().overrides, [id]: null };
    set({ overrides: next }); persist(next);
  },
  applyBinds: (binds) => {
    const next: Overrides = {};
    for (const cmd of COMMAND_META) {
      const desired = cmd.id in binds ? binds[cmd.id] : cmd.defaultCombo;
      const norm = desired == null ? null : normalizeCombo(desired);
      const defNorm = cmd.defaultCombo == null ? null : normalizeCombo(cmd.defaultCombo);
      if (norm !== defNorm) next[cmd.id] = norm; // else matches default → store no override
    }
    set({ overrides: next }); persist(next);
  },
  resetAll: () => { set({ overrides: {} }); persist({}); },
}));

/* ── presets ("shortcut styles") ─────────────────────────────────────────── */

/* A preset is a set of combos that DIFFER from the shipped defaults; applying one replaces the
 * user overrides so the effective keymap matches it. `detectPreset` names the current keymap (or
 * 'custom' once hand-edited). */

export interface KeymapPreset {
  id: string;
  labelKey: string;
  /** Combos that DIFFER from the shipped defaults (id → combo, null = unbound). Others inherit. */
  binds: Record<string, string | null>;
}

/** Pro is the desktop-editor idiom (single-letter tool keys, V/B/E), for hands that learned it. A
 *  FROZEN keymap: it states its combos outright rather than inheriting, so a change to the shipped
 *  defaults never moves a key under those hands. */
const PRO: Record<string, string | null> = {
  'surface.mountain': '1', 'surface.river': '2', 'surface.road': '3',
  'tool.move': 'v', 'tool.brush': 'b', 'tool.eraser': 'e', 'tool.edgecut': 'x',
  'tool.free': null, 'tool.shape_cycle': null, 'tool.auto_trim': null,
  'tool.line': 'f', 'tool.curve': 'g', 'tool.rect': 'r', 'tool.circle': 'c', 'tool.smart': 't',
  'brush.bigger': ']', 'brush.smaller': '[', 'layer.up': 'q', 'layer.down': 'z',
  'selection.rotate_cw': '.', 'selection.rotate_ccw': ',',
  'camera.zoom_in': '=', 'camera.zoom_out': '-',
  'app.help': 'shift+?', 'app.menu': 'm',
  'overlay.grid': 'shift+g', 'overlay.numbers': 'shift+n', 'overlay.chunks': 'shift+c',
};

/** Numeric keeps the toolbar order, with arrow-key panning and separate surface shortcuts. */
const NUMERIC: Record<string, string | null> = {
  ...PRO,
  'surface.mountain': 'shift+q', 'surface.river': 'w', 'surface.road': 'e',
  'tool.brush': '1', 'tool.eraser': '2', 'tool.edgecut': '3', 'tool.smart': '4',
  'tool.shape_cycle': '5', 'tool.free': null, 'tool.line': null, 'tool.curve': null, 'tool.rect': null, 'tool.circle': null,
  'tool.auto_trim': 'q',
  'camera.pan_up': 'arrowup', 'camera.pan_down': 'arrowdown',
  'camera.pan_left': 'arrowleft', 'camera.pan_right': 'arrowright',
  'layer.up': 'pageup', 'layer.down': 'pagedown',
};

export const PRESETS: KeymapPreset[] = [
  { id: 'default', labelKey: 'kbd.preset.default', binds: {} },
  { id: 'pro', labelKey: 'kbd.preset.pro', binds: PRO },
  { id: 'numeric', labelKey: 'kbd.preset.numeric', binds: NUMERIC },
];

/** Full effective keymap of a preset: every command → normalized combo|null. */
export function presetBinds(preset: KeymapPreset): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const cmd of COMMAND_META) {
    const raw = cmd.id in preset.binds ? preset.binds[cmd.id] : cmd.defaultCombo;
    m.set(cmd.id, raw == null ? null : normalizeCombo(raw));
  }
  return m;
}

/** Full effective keymap under the current overrides. */
function currentBinds(overrides: Overrides): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const cmd of COMMAND_META) {
    const c = effectiveCombo(overrides, cmd.id);
    m.set(cmd.id, c == null ? null : normalizeCombo(c));
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
  const cur = currentBinds(overrides);
  for (const p of PRESETS) if (mapsEqual(cur, presetBinds(p))) return p.id;
  return 'custom';
}

/* ── JSON import / export ─────────────────────────────────────────────────── */

/* A preset must be internally valid (unique combo per command) or applying it would leave a broken
 * keymap; import must reject conflicts so a crafted/edited file can't collide two commands onto one
 * key. */

const FILE_MARK = 'petitmaker-keybinds';

/** Export the current effective keymap as a portable, pretty-printed JSON string. */
export function serializeKeybinds(overrides: Overrides): string {
  const binds: Record<string, string | null> = {};
  for (const [id, combo] of currentBinds(overrides)) binds[id] = combo;
  return JSON.stringify({ app: FILE_MARK, version: 1, binds }, null, 2);
}

export interface ParseResult {
  ok: boolean;
  binds?: Record<string, string | null>;
  error?: 'invalid-json' | 'invalid-shape' | 'invalid-combo' | 'reserved-combo' | 'duplicate-combo' | 'empty';
}

/** Parse + validate imported keybinds JSON → a binds map limited to known commands. Accepts either
 *  the exported envelope ({binds:{…}}) or a bare id→combo map. Rejects malformed combos, duplicates,
 *  and a command parked on a shifted twin of the file's own UI-zoom bindings; silently ignores
 *  unknown command ids (forward-compat). */
export function parseKeybinds(text: string): ParseResult {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'invalid-json' }; }
  const env = data as { binds?: unknown } | null;
  const raw = env && typeof env === 'object' && env.binds && typeof env.binds === 'object' ? env.binds : data;
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid-shape' };

  const binds: Record<string, string | null> = {};
  const seen = new Map<string, string>(); // normalized combo → command id
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!META_BY_ID.has(id)) continue; // ignore unknown ids
    if (val === null) { binds[id] = null; continue; }
    if (typeof val !== 'string') return { ok: false, error: 'invalid-combo' };
    const n = normalizeCombo(val);
    if (!n) return { ok: false, error: 'invalid-combo' };
    const prev = seen.get(n);
    if (prev && prev !== id) return { ok: false, error: 'duplicate-combo' };
    seen.set(n, id);
    binds[id] = n;
  }
  if (Object.keys(binds).length === 0) return { ok: false, error: 'empty' };
  // The twins are read from the file's OWN zoom bindings (ids it omits keep their defaults, exactly
  // as applyBinds resolves them), so a file that moves the zoom keys is judged where it put them.
  const variants = uiZoomVariantCombos(binds);
  for (const [id, combo] of Object.entries(binds)) {
    if (combo && !UI_ZOOM_IDS.includes(id) && variants.has(combo)) return { ok: false, error: 'reserved-combo' };
  }
  return { ok: true, binds };
}
