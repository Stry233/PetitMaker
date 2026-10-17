/*
 * The keymap registry: every discrete keyboard operation's identity (id, category, label, default
 * combo, continuous), the fixed aliases beside it, and the shipped presets ("shortcut styles").
 * What a command does lives in `editor/commands/commands.ts`, which zips this list with its run bodies; the
 * pointer machine's held-key pan loop (view/interaction/use-view-shortcuts) reads only this half.
 */
import { forEdition, type EditionVariant } from '../../platform/build/edition';
import type { I18nKey } from '../../i18n/keys';

export type CommandCategory =
  | 'surface' | 'tool' | 'brush' | 'layer' | 'selection' | 'camera' | 'view' | 'history' | 'app' | 'overlay';

interface CommandRowShape {
  id: string;
  category: CommandCategory;
  labelKey: I18nKey;
  /** The shipped combo; null for a toolbar command, whose keys the toolbar table gives per context. */
  defaultCombo: string | null;
  /** A HELD-key action (continuous pan), not a discrete one-shot. Shown + rebindable on the keyboard
   *  page, but the discrete engine (useEditorShortcuts) skips it — the held rAF loop in
   *  view/interaction/use-view-shortcuts reads its effective key instead. */
  continuous?: boolean;
  /** Answered by an always-live listener that keeps working behind an open modal, so it has no
   *  Run body and the discrete engine leaves its combo alone. */
  listener?: boolean;
}

/** A registry row: `lite: false` keeps the command out of the offline edition. */
type CommandRow = CommandRowShape & EditionVariant<CommandRowShape>;

/* ── the registry ────────────────────────────────────────────────────────── */

const ALL_COMMAND_META = [
  // Build surface (opens the Build panel on that surface)
  { id: 'surface.mountain', category: 'surface', labelKey: 'menu.build_mountain', defaultCombo: null },
  { id: 'surface.river',    category: 'surface', labelKey: 'menu.build_river',    defaultCombo: null },
  { id: 'surface.road',     category: 'surface', labelKey: 'menu.build_road',     defaultCombo: null },

  // Tools
  { id: 'tool.move',    category: 'tool', labelKey: 'menu.move',           defaultCombo: null },
  // A toolbar command's shipped keys are per toolbar, in `state/keymap/toolbar.ts:toolbarBindings`;
  // its row here carries none.
  { id: 'tool.brush',   category: 'tool', labelKey: 'terrain.brush',       defaultCombo: null },
  { id: 'tool.erase',   category: 'tool', labelKey: 'design.eraser',       defaultCombo: null },
  { id: 'tool.trim',    category: 'tool', labelKey: 'design.edge_cut',     defaultCombo: null },
  { id: 'tool.smart',   category: 'tool', labelKey: 'smart.build',         defaultCombo: null },
  { id: 'tool.measure', category: 'tool', labelKey: 'annot.measure', defaultCombo: null },
  { id: 'tool.shape_cycle', category: 'tool', labelKey: 'terrain.shapes', defaultCombo: null },
  { id: 'tool.free',    category: 'tool', labelKey: 'terrain.shape.free',  defaultCombo: null },
  { id: 'tool.line',    category: 'tool', labelKey: 'eraser.line',         defaultCombo: null },
  { id: 'tool.curve',   category: 'tool', labelKey: 'eraser.curve',        defaultCombo: null },
  { id: 'tool.rect',    category: 'tool', labelKey: 'eraser.rect',         defaultCombo: null },
  { id: 'tool.circle',  category: 'tool', labelKey: 'eraser.circle',       defaultCombo: null },
  // The toolbar's last option group: auto edge cut on a terrain surface; what it steps elsewhere is
  // `state/keymap/toolbar.ts:CONTEXT_KEYS`.
  { id: 'tool.option_cycle', category: 'tool', labelKey: 'edgecut.auto', defaultCombo: null },

  // Shape-drag constrain (held): snaps line/rect/circle drags to straight/square/round. Default
  // Shift, rebindable. Continuous: the shape tools read it through `held.ts:isCommandHeld`.
  { id: 'tool.constrain', category: 'tool', labelKey: 'shortcut.shape_constrain', defaultCombo: 'shift', continuous: true },

  // Curve handle break (held): dragging one end of an anchor's direction line turns the other with
  // it; held, the two sides turn apart. Continuous: CurveHandles reads it through `held.ts`.
  { id: 'tool.break_handle', category: 'tool', labelKey: 'shortcut.break_handle', defaultCombo: 'alt', continuous: true },

  // Brush size + active layer
  { id: 'brush.bigger',  category: 'brush', labelKey: 'a11y.brush_increase', defaultCombo: null },
  { id: 'brush.smaller', category: 'brush', labelKey: 'a11y.brush_decrease', defaultCombo: null },
  { id: 'layer.up',      category: 'layer', labelKey: 'shortcut.layer_up',   defaultCombo: null },
  { id: 'layer.down',    category: 'layer', labelKey: 'shortcut.layer_down', defaultCombo: null },

  // Selection
  { id: 'selection.rotate_cw',  category: 'selection', labelKey: 'shortcut.rotate_cw',  defaultCombo: 'e' },
  { id: 'selection.rotate_ccw', category: 'selection', labelKey: 'shortcut.rotate_ccw', defaultCombo: null },
  { id: 'selection.delete',     category: 'selection', labelKey: 'shortcut.delete',     defaultCombo: 'r' },
  { id: 'selection.deselect',   category: 'selection', labelKey: 'shortcut.deselect',   defaultCombo: 'escape' },

  // Multi-select (held): Ctrl turns a click into a membership toggle and a drag into a rubber
  // band. Continuous, so the pointer machine reads it through `held.ts` and the
  // discrete engine skips it. Declared here to be listed in the keyboard modal and rebindable.
  { id: 'selection.multi', category: 'selection', labelKey: 'shortcut.multi_select', defaultCombo: 'ctrl', continuous: true },
  { id: 'selection.all',   category: 'selection', labelKey: 'shortcut.select_all',   defaultCombo: 'ctrl+a' },

  // Camera / view
  { id: 'camera.zoom_in',  category: 'camera', labelKey: 'shortcut.zoom_in',  defaultCombo: null },
  { id: 'camera.zoom_out', category: 'camera', labelKey: 'shortcut.zoom_out', defaultCombo: null },
  { id: 'camera.fit',      category: 'camera', labelKey: 'a11y.fit_view',     defaultCombo: 'ctrl+0' },

  // Continuous camera pan (held keys) — the rAF loop in use-view-shortcuts reads these keys.
  // Rebindable + shown on the keyboard page.
  { id: 'camera.pan_up',    category: 'camera', labelKey: 'shortcut.pan_up',    defaultCombo: 'w', continuous: true },
  { id: 'camera.pan_left',  category: 'camera', labelKey: 'shortcut.pan_left',  defaultCombo: 'a', continuous: true },
  { id: 'camera.pan_down',  category: 'camera', labelKey: 'shortcut.pan_down',  defaultCombo: 's', continuous: true },
  { id: 'camera.pan_right', category: 'camera', labelKey: 'shortcut.pan_right', defaultCombo: 'd', continuous: true },

  // Held: a left drag pans the camera while this is down, in any tool mode, so a brush never has to
  // fight the camera. Continuous, so the pointer machine reads it through `held.ts`.
  { id: 'camera.pan_drag', category: 'camera', labelKey: 'shortcut.pan_drag', defaultCombo: 'space', continuous: true },
  { id: 'view.toggle',     category: 'view',   labelKey: 'shortcut.toggle_view', defaultCombo: '`' },

  // History. While painting a Generate region, undo/redo pop the region stroke instead of a map edit
  // (see editor/commands/commands.ts's CommandContext); that reroute keys off the command, so it follows a
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
  { id: 'app.export_json',  category: 'app', labelKey: 'menu.export', defaultCombo: 'ctrl+s', lite: false },
  { id: 'app.export_image', category: 'app', labelKey: 'menu.image',  defaultCombo: 'ctrl+p' },
  { id: 'app.whats_this', category: 'app', labelKey: 'shortcut.whats_this', defaultCombo: 'shift+h', listener: true },
  { id: 'app.help', category: 'app', labelKey: 'menu.help', defaultCombo: null },
  { id: 'app.menu',  category: 'app', labelKey: 'shortcut.toggle_menu', defaultCombo: null },

  // UI scale (the chrome, not the map). Carried out by the always-live listener
  // (ui/app/use-ui-zoom-shortcut.ts:useUiZoomShortcut), which reads these two effective
  // combos and so follows a rebind.
  { id: 'app.ui_zoom_in',  category: 'app', labelKey: 'shortcut.ui_zoom_in',  defaultCombo: 'ctrl+=', listener: true },
  { id: 'app.ui_zoom_out', category: 'app', labelKey: 'shortcut.ui_zoom_out', defaultCombo: 'ctrl+-', listener: true },

  // Overlay toggles
  { id: 'overlay.grid',    category: 'overlay', labelKey: 'shortcut.toggle_grid',      defaultCombo: null },
  { id: 'overlay.numbers', category: 'overlay', labelKey: 'a11y.toggle_layer_numbers', defaultCombo: null },
  { id: 'overlay.chunks',  category: 'overlay', labelKey: 'shortcut.toggle_chunks',    defaultCombo: null },
] as const satisfies readonly CommandRow[];

type Row = typeof ALL_COMMAND_META[number];
export type CommandId = Row['id'];
/** The commands the discrete engine runs: neither held nor answered by a listener. */
export type RunCommandId = Exclude<CommandId, Extract<Row, { continuous: true } | { listener: true }>['id']>;

export interface CommandMeta extends CommandRowShape {
  id: CommandId;
}

export const COMMAND_META: readonly CommandMeta[] = forEdition<CommandMeta>(ALL_COMMAND_META);

export const META_BY_ID: ReadonlyMap<string, CommandMeta> = new Map(COMMAND_META.map((c) => [c.id, c]));

/** Fixed secondary bindings — a command has one registry combo, but the engine also wires these
 *  aliases so conventional alternates work. Not shown as separate rows / not user-editable. */
export const ALIASES: { combo: string; commandId: CommandId }[] = [
  { combo: 'ctrl+y',    commandId: 'history.redo' },      // Windows-muscle-memory redo
  { combo: 'delete',    commandId: 'selection.delete' },  // The conventional delete key, beside the default R
  { combo: 'backspace', commandId: 'selection.delete' },  // Mac laptops' "Delete" key
  // Arrow keys pan alongside WASD (the arrows are the secondary binding; WASD is the editable
  // primary). Listed here so they show on the keyboard + drive the held-pan loop from one source.
  { combo: 'arrowup',    commandId: 'camera.pan_up' },
  { combo: 'arrowdown',  commandId: 'camera.pan_down' },
  { combo: 'arrowleft',  commandId: 'camera.pan_left' },
  { combo: 'arrowright', commandId: 'camera.pan_right' },
];

/** The ids commands were stored under before they were renamed. */
const RENAMED: Readonly<Record<string, CommandId>> = {
  'tool.eraser': 'tool.erase',
  'tool.edgecut': 'tool.trim',
  'tool.auto_trim': 'tool.option_cycle',
};

/** `binds` (a stored or imported keymap) with any id from before a rename under the id it became;
 *  an entry already under the new id wins. */
export function withCurrentIds<T>(binds: Readonly<Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, value] of Object.entries(binds)) {
    const current = RENAMED[id];
    if (current === undefined) out[id] = value;
    else if (!(current in binds)) out[current] = value;
  }
  return out;
}

/** The commands a planet session answers. Every other binding still takes its key there, so no
 *  browser default fires in its place. */
export const PLANET_SESSION_COMMANDS: ReadonlySet<string> = new Set([
  'history.undo', 'history.redo',
  'camera.zoom_in', 'camera.zoom_out', 'camera.fit', 'app.ui_zoom_in', 'app.ui_zoom_out', 'overlay.chunks',
  'surface.mountain', 'surface.river',
  'tool.brush', 'tool.erase', 'tool.shape_cycle', 'tool.free', 'tool.line', 'tool.curve', 'tool.rect', 'tool.circle',
  'brush.bigger', 'brush.smaller',
  'selection.rotate_cw', 'selection.rotate_ccw', 'selection.delete', 'selection.deselect',
  'app.menu', 'app.help',
] satisfies CommandId[]);

/** The commands a hand repair answers: history, the camera, deleting and deselecting its objects,
 *  the menu and Help. */
export const REPAIR_SESSION_COMMANDS: ReadonlySet<string> = new Set([
  'history.undo', 'history.redo',
  'camera.zoom_in', 'camera.zoom_out', 'camera.fit', 'app.ui_zoom_in', 'app.ui_zoom_out',
  'selection.delete', 'selection.deselect',
  'app.menu', 'app.help',
] satisfies CommandId[]);

/** The two commands the always-live UI-zoom listener carries out. */
export const UI_ZOOM_IDS: readonly string[] = ['app.ui_zoom_in', 'app.ui_zoom_out'] satisfies readonly CommandId[];

/* ── presets ("shortcut styles") ─────────────────────────────────────────── */

/* A preset is a set of combos that differ from the shipped defaults; applying one replaces the
 * user overrides so the effective keymap matches it. `detectPreset` names the current keymap (or
 * 'custom' once hand-edited). */

export interface KeymapPreset {
  id: string;
  labelKey: I18nKey;
  /** Combos that differ from the shipped defaults (id → combo, null = unbound). Others inherit. */
  binds: Record<string, string | null>;
}

/** Pro is the desktop-editor idiom (single-letter tool keys, V/B/E), for hands that learned it. A
 *  Frozen keymap: it states its combos outright rather than inheriting, so a change to the shipped
 *  defaults never moves a key under those hands. */
const PRO: Record<string, string | null> = {
  'surface.mountain': '1', 'surface.river': '2', 'surface.road': '3',
  'tool.move': 'v', 'tool.brush': 'b', 'tool.erase': 'e', 'tool.trim': 'x',
  'tool.free': null, 'tool.measure': null, 'tool.shape_cycle': null, 'tool.option_cycle': null,
  'tool.line': 'f', 'tool.curve': 'g', 'tool.rect': 'r', 'tool.circle': 'c', 'tool.smart': 't',
  'brush.bigger': ']', 'brush.smaller': '[', 'layer.up': 'q', 'layer.down': 'z',
  'selection.rotate_cw': '.', 'selection.rotate_ccw': ',', 'selection.delete': 'delete',
  'camera.zoom_in': '=', 'camera.zoom_out': '-',
  'app.help': 'shift+?', 'app.menu': 'm',
  'overlay.grid': 'shift+g', 'overlay.numbers': 'shift+n', 'overlay.chunks': 'shift+c',
};

/** Numeric keeps the toolbar order, with arrow-key panning and separate surface shortcuts. */
const NUMERIC: Record<string, string | null> = {
  ...PRO,
  'surface.mountain': 'shift+q', 'surface.river': 'w', 'surface.road': 'e',
  'tool.brush': '1', 'tool.erase': '2', 'tool.trim': '3', 'tool.smart': '4',
  'tool.measure': '5', 'tool.shape_cycle': '6', 'tool.free': null, 'tool.line': null, 'tool.curve': null, 'tool.rect': null, 'tool.circle': null,
  'tool.option_cycle': 'q',
  'camera.pan_up': 'arrowup', 'camera.pan_down': 'arrowdown',
  'camera.pan_left': 'arrowleft', 'camera.pan_right': 'arrowright',
  'layer.up': 'pageup', 'layer.down': 'pagedown',
};

export const PRESETS: KeymapPreset[] = [
  { id: 'default', labelKey: 'kbd.preset.default', binds: {} },
  { id: 'pro', labelKey: 'kbd.preset.pro', binds: PRO },
  { id: 'numeric', labelKey: 'kbd.preset.numeric', binds: NUMERIC },
];
