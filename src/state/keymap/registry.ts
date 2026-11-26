/*
 * The keymap registry: every discrete keyboard operation's identity (id, category, label, default
 * combo, continuous), the fixed aliases beside it, and the shipped presets ("shortcut styles").
 * What a command does lives in `editor/commands/commands.ts`, which zips this list with its run bodies; the
 * pointer machine's held-key pan loop (view/interaction/use-view-shortcuts) reads only this half.
 */
import { forEdition, type EditionVariant } from '../../platform/build/edition';
import type { I18nKey } from '../../i18n/keys';
import type { SurfaceTool } from '../editing/edit-mode';

export type CommandCategory =
  | 'surface' | 'tool' | 'brush' | 'selection' | 'camera' | 'view' | 'history' | 'app' | 'overlay';

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
  /** Its key is heard by an always-live listener that keeps working behind an open modal and runs
   *  the command's body, so the discrete engine leaves its combo alone. */
  listener?: boolean;
  /** The browser's own clipboard event still follows the key: the engine runs the body without
   *  taking the key's default, so the `copy`, `cut` or `paste` event can carry the clipboard. */
  native?: boolean;
  /** A cycle through a group of options: Shift with its key steps the group backwards, where no other
   *  command holds that combo (`resolve.ts:reverseCombos`). */
  reversible?: boolean;
  /** The keymap revision the command joined in, absent for those a keymap first saved knew; a new
   *  command takes the next revision, so a keymap saved earlier is given its style's key for it
   *  (`store.ts:withLaterCommands`). */
  since?: number;
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
  { id: 'tool.shape_cycle', category: 'tool', labelKey: 'terrain.shapes', defaultCombo: null, reversible: true },
  { id: 'tool.free',    category: 'tool', labelKey: 'terrain.shape.free',  defaultCombo: null },
  { id: 'tool.line',    category: 'tool', labelKey: 'eraser.line',         defaultCombo: null },
  { id: 'tool.curve',   category: 'tool', labelKey: 'eraser.curve',        defaultCombo: null },
  { id: 'tool.rect',    category: 'tool', labelKey: 'eraser.rect',         defaultCombo: null },
  { id: 'tool.circle',  category: 'tool', labelKey: 'eraser.circle',       defaultCombo: null },
  // The toolbar's last option group: auto edge cut on a terrain surface; what it steps elsewhere is
  // `state/keymap/toolbar.ts:CONTEXT_KEYS`.
  { id: 'tool.option_cycle', category: 'tool', labelKey: 'edgecut.auto', defaultCombo: null, reversible: true },
  // The mountain brush's and eraser's thickness; L for layers, a key no toolbar and no preset binds.
  { id: 'tool.thickness_cycle', category: 'tool', labelKey: 'terrain.thickness', defaultCombo: 'l', since: 1, reversible: true },

  // Shape-drag constrain (held): snaps line/rect/circle drags to straight/square/round. Default
  // Shift, rebindable. Continuous: the shape tools read it through `held.ts:isCommandHeld`.
  { id: 'tool.constrain', category: 'tool', labelKey: 'shortcut.shape_constrain', defaultCombo: 'shift', continuous: true },

  // Curve handle break (held): dragging one end of an anchor's direction line turns the other with
  // it; held, the two sides turn apart. Continuous: CurveHandles reads it through `held.ts`.
  { id: 'tool.break_handle', category: 'tool', labelKey: 'shortcut.break_handle', defaultCombo: 'alt', continuous: true },

  // Brush size
  { id: 'brush.bigger',  category: 'brush', labelKey: 'a11y.brush_increase', defaultCombo: null },
  { id: 'brush.smaller', category: 'brush', labelKey: 'a11y.brush_decrease', defaultCombo: null },

  // Selection
  { id: 'selection.rotate_cw',  category: 'selection', labelKey: 'shortcut.rotate_cw',  defaultCombo: 'e' },
  { id: 'selection.rotate_ccw', category: 'selection', labelKey: 'shortcut.rotate_ccw', defaultCombo: null },
  { id: 'selection.flip',       category: 'selection', labelKey: 'shortcut.flip',       defaultCombo: 'f', since: 1 },
  { id: 'selection.delete',     category: 'selection', labelKey: 'shortcut.delete',     defaultCombo: 'r' },
  { id: 'selection.deselect',   category: 'selection', labelKey: 'shortcut.deselect',   defaultCombo: 'escape' },

  // Multi-select (held): Ctrl turns a click into a membership toggle and a drag into a rubber
  // band. Continuous, so the pointer machine reads it through `held.ts` and the
  // discrete engine skips it. Declared here to be listed in the keyboard modal and rebindable.
  { id: 'selection.multi', category: 'selection', labelKey: 'shortcut.multi_select', defaultCombo: 'ctrl', continuous: true },
  { id: 'selection.all',   category: 'selection', labelKey: 'shortcut.select_all',   defaultCombo: 'ctrl+a' },
  { id: 'selection.copy',  category: 'selection', labelKey: 'shortcut.copy',  defaultCombo: 'ctrl+c', native: true },
  { id: 'selection.cut',   category: 'selection', labelKey: 'shortcut.cut',   defaultCombo: 'ctrl+x', native: true },
  { id: 'selection.paste', category: 'selection', labelKey: 'shortcut.paste', defaultCombo: 'ctrl+v', native: true },

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

  // UI scale (the chrome, not the map). Their keys are heard by the always-live listener
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
/** The commands with a body: every one but the held ones. A listener row's body is run by its listener. */
export type RunCommandId = Exclude<CommandId, Extract<Row, { continuous: true }>['id']>;

export interface CommandMeta extends CommandRowShape {
  id: CommandId;
}

export const COMMAND_META: readonly CommandMeta[] = forEdition<CommandMeta>(ALL_COMMAND_META);

export const META_BY_ID: ReadonlyMap<string, CommandMeta> = new Map(COMMAND_META.map((c) => [c.id, c]));

/** The revision a keymap is saved at: the newest command's. */
export const KEYMAP_REVISION = Math.max(0, ...COMMAND_META.map((c) => c.since ?? 0));

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

/** The keys no command can sit on, alone or under modifiers, by the token a combo ends with: the
 *  browser or the system answers them before the page (Help, Find, Reload, the address bar, full
 *  screen, the developer tools, focus travel, a focused control's press, the screenshot and the two
 *  locks), and taking their default is unreliable. The keypad's Enter (`numenter`) is its own key. */
export const UNBINDABLE_KEYS: ReadonlySet<string> = new Set([
  'f1', 'f3', 'f5', 'f6', 'f11', 'f12', 'tab', 'capslock', 'enter', 'printscreen', 'numlock',
]);

/** Whether a normalized combo ends on a key a command can sit on. */
export function comboBindable(combo: string): boolean {
  return !UNBINDABLE_KEYS.has(combo.split('+').pop() ?? '');
}

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

/** The command that takes up each tool of a surface's row. */
export const SURFACE_TOOL_COMMANDS = {
  brush: 'tool.brush', erase: 'tool.erase', trim: 'tool.trim', smart: 'tool.smart',
} as const satisfies Record<SurfaceTool, CommandId>;

/** The commands that change the map, its history or its selection, which none of them reaches while
 *  a stand-in is shown in its place (`map-stand-in.ts:standInShown`); a new such command joins them. */
export const MAP_EDIT_COMMANDS: ReadonlySet<string> = new Set<string>([
  ...([
    'history.undo', 'history.redo',
    'selection.rotate_cw', 'selection.rotate_ccw', 'selection.flip', 'selection.delete', 'selection.all', 'selection.cut', 'selection.paste',
    'tool.smart',
  ] satisfies CommandId[]),
  // No key runs these, so the keymap has no row for them.
  'generate.land', 'generate.clear',
  'selection.face', 'selection.pick', 'selection.save_blueprint', 'selection.narrow', 'notes.merge', 'notes.flip', 'terrain.peel',
  'selection.clear',
]);

/** The command whose key backs out of the newest state that stands (`platform/input/back-stack.ts`),
 *  heard by the back stack's own listener rather than the shortcut engine. */
export const BACK_COMMAND = 'selection.deselect' satisfies CommandId;

/** The two commands the always-live UI-zoom listener carries out. */
export const UI_ZOOM_IDS: readonly string[] = ['app.ui_zoom_in', 'app.ui_zoom_out'] satisfies readonly CommandId[];

/* ── presets ("shortcut styles") ─────────────────────────────────────────── */

/* A preset is a set of combos that differ from the shipped defaults; applying one replaces the
 * user overrides so the effective keymap matches it. `detectPreset` names the current keymap (or
 * 'custom' once hand-edited). */

interface KeymapPreset {
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
  'brush.bigger': ']', 'brush.smaller': '[', 'tool.thickness_cycle': 'l',
  'selection.rotate_cw': '.', 'selection.rotate_ccw': ',', 'selection.flip': '/', 'selection.delete': 'delete',
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
};

export const PRESETS: KeymapPreset[] = [
  { id: 'default', labelKey: 'kbd.preset.default', binds: {} },
  { id: 'pro', labelKey: 'kbd.preset.pro', binds: PRO },
  { id: 'numeric', labelKey: 'kbd.preset.numeric', binds: NUMERIC },
];
