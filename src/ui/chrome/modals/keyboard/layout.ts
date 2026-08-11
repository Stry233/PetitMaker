/*
 * The physical keyboard model for the shortcuts page. A US-ANSI main block described as rows of
 * keys; each key knows the combo-char it produces at rest (`base`) and under Shift (`shift`, for
 * digits/punctuation whose glyph changes). `comboFor(key, layer)` turns a key + the active modifier
 * layer into a normalized combo string, which the page looks up in the binding index. Pure data +
 * pure helpers, so the board's geometry and combo mapping are unit-testable without the DOM.
 */
import { normalizeCombo, type CommandCategory } from '../../../../core/runtime/keybindings';
import { eventKeyToken } from '../../../../tools/shortcut-manager';

/** A modifier layer: any combination of the three chord modifiers (base = all false). */
export interface Layer { ctrl: boolean; alt: boolean; shift: boolean }

export type ModId = 'ctrl' | 'alt' | 'shift';

export interface KeyDef {
  /** Combo char at rest (lowercase), e.g. 'b', '1', '['. Also the engine key name for specials. */
  base: string;
  /** Combo char when Shift is held, for keys whose glyph shifts (digits/punctuation). */
  shift?: string;
  /** Glyph drawn on the keycap. */
  label: string;
  /** Width in key units (1 = a normal letter key). */
  w?: number;
  /** A modifier/space key: not bindable. `mod` makes it toggle that layer when clicked. */
  fixed?: boolean;
  mod?: ModId;
  /** This key REPRESENTS a modifier layer, so it lights up while that layer is engaged, but clicking
   *  it does whatever its own binding says. `mod` implies this; `layerOf` is for a modifier key that
   *  also carries a command (Shift holds the constrain action, Ctrl the multi-select one), which
   *  must still be selectable by clicking rather than toggling the layer. */
  layerOf?: ModId;
  /** An empty layout gap (e.g. between F-key groups) — renders no keycap. */
  spacer?: boolean;
  /** Numpad grid placement (1-indexed). When set, the key is laid out in the keypad CSS grid rather
   *  than a flat row, so tall (`rowSpan`) and wide (`colSpan`) keys mirror a real numeric keypad. */
  col?: number;
  row?: number;
  colSpan?: number;
  rowSpan?: number;
}

const K = (base: string, label = base.toUpperCase(), shift?: string): KeyDef => ({ base, label, shift });
const FIX = (base: string, label: string, w = 1, mod?: ModId): KeyDef => ({ base, label, w, fixed: true, mod });
/** A browser-reserved function key (F1/F3/F5/…): shown but NOT bindable — the browser intercepts it
 *  (Help/Find/Reload/Fullscreen/DevTools) and preventDefault is unreliable, like PrintScreen. */
const FF = (base: string, label: string): KeyDef => ({ base, label, fixed: true });

/** The ANSI main block, top row to bottom. Every main row totals 15 units so the right edge aligns,
 *  exactly as on a real keyboard (Backspace 2u, Tab/\ 1.5u, Caps 1.75u, Enter 2.25u, Shift 2.25/2.75u,
 *  Space filling the bottom row). Esc sits on its own function-row slot at the top-left (a real board
 *  keeps it off the number row). The function row carries Esc + F1–F12 (grouped by spacers); the
 *  F-keys are bindable but note some (F5/F11/F12) may be intercepted by the browser. */
export const KEY_ROWS: KeyDef[][] = [
  [
    { base: 'escape', label: 'Esc', w: 1.5 },
    { base: '', label: '', spacer: true, w: 0.5 },
    FF('f1', 'F1'), K('f2', 'F2'), FF('f3', 'F3'), K('f4', 'F4'),
    { base: '', label: '', spacer: true, w: 0.5 },
    FF('f5', 'F5'), FF('f6', 'F6'), K('f7', 'F7'), K('f8', 'F8'),
    { base: '', label: '', spacer: true, w: 0.5 },
    K('f9', 'F9'), K('f10', 'F10'), FF('f11', 'F11'), FF('f12', 'F12'),
  ],
  [
    K('`', '`', '~'),
    K('1', '1', '!'), K('2', '2', '@'), K('3', '3', '#'), K('4', '4', '$'), K('5', '5', '%'),
    K('6', '6', '^'), K('7', '7', '&'), K('8', '8', '*'), K('9', '9', '('), K('0', '0', ')'),
    K('-', '-', '_'), K('=', '=', '+'),
    { base: 'backspace', label: '⌫', w: 2 },
  ],
  [
    FIX('tab', 'Tab', 1.5),
    K('q'), K('w'), K('e'), K('r'), K('t'), K('y'), K('u'), K('i'), K('o'), K('p'),
    // \ is 1.5u (the key that carries this row's slack) so the QWERTY row reaches 15u and its right
    // edge lines up with Backspace/Enter/Shift. Other rows already total 15u — don't widen them.
    K('[', '[', '{'), K(']', ']', '}'), { base: '\\', label: '\\', shift: '|', w: 1.5 },
  ],
  [
    FIX('caps', 'Caps', 1.75),
    K('a'), K('s'), K('d'), K('f'), K('g'), K('h'), K('j'), K('k'), K('l'),
    K(';', ';', ':'), K("'", "'", '"'),
    FIX('enter', 'Enter', 2.25),
  ],
  [
    // Both Shift keys carry the rebindable 'constrain' command (base 'shift' → tool.constrain), not a
    // layer toggle — the top layer chips switch layers. Click a Shift key to edit the constrain key.
    { base: 'shift', label: 'Shift', w: 2.25, layerOf: 'shift' },
    K('z'), K('x'), K('c'), K('v'), K('b'), K('n'), K('m'),
    K(',', ',', '<'), K('.', '.', '>'), K('/', '/', '?'),
    { base: 'shift', label: 'Shift', w: 2.75, layerOf: 'shift' },
  ],
  [
    // Ctrl carries the rebindable 'multi-select' command and Alt the 'break curve handle' one, so
    // like Shift they are SELECTABLE rather than layer toggles — the layer chips above the board
    // switch layers. A modifier keycap becomes bindable once something is bound to it; one with
    // nothing on it would offer to edit nothing.
    { base: 'ctrl', label: 'Ctrl', w: 1.5, layerOf: 'ctrl' },
    { base: 'alt', label: 'Alt', w: 1.5, layerOf: 'alt' },
    { base: 'space', label: 'Space', w: 9 },
    { base: 'alt', label: 'Alt', w: 1.5, layerOf: 'alt' },
    { base: 'ctrl', label: 'Ctrl', w: 1.5, layerOf: 'ctrl' },
  ],
];

const NP = (base: string, label: string, col: number, row: number, span?: { colSpan?: number; rowSpan?: number }): KeyDef =>
  ({ base, label, col, row, ...span });

export const NUMPAD_COLS = 4;
export const NUMPAD_ROWS_N = 5;

/** The numeric keypad, placed in a 4×5 CSS grid mirroring a real keyboard: a NumLock header row, a
 *  DOUBLE-HEIGHT `+` and `Enter` down the right edge, and a DOUBLE-WIDTH `0`. Numpad keys carry no
 *  default binding — they exist so users can bind to them; their tokens (`num5`, `numadd`, …) are
 *  distinct from the top-row digits. NumLock is a fixed (non-bindable) label. */
export const NUMPAD: KeyDef[] = [
  { base: 'numlock', label: 'Num', fixed: true, col: 1, row: 1 },
  NP('numdivide', '÷', 2, 1), NP('nummultiply', '×', 3, 1), NP('numsubtract', '−', 4, 1),
  NP('num7', '7', 1, 2), NP('num8', '8', 2, 2), NP('num9', '9', 3, 2),
  NP('numadd', '+', 4, 2, { rowSpan: 2 }),
  NP('num4', '4', 1, 3), NP('num5', '5', 2, 3), NP('num6', '6', 3, 3),
  NP('num1', '1', 1, 4), NP('num2', '2', 2, 4), NP('num3', '3', 3, 4),
  NP('numenter', '⏎', 4, 4, { rowSpan: 2 }),
  NP('num0', '0', 1, 5, { colSpan: 2 }), NP('numdecimal', '.', 3, 5),
];

export const NAV_COLS = 3;
export const NAV_ROWS_N = 6;

/** The function + navigation + arrow cluster between the main block and the numpad, in a 3×6 grid
 *  spanning the FULL keyboard height (so its bottom aligns with the main block): PrtSc/ScrLk/Pause at
 *  the F-row level, the Ins/Home/PgUp · Del/End/PgDn block below, then a GAP row, then the inverted-T
 *  arrows at the bottom (aligned with the modifier row) — exactly a full-size keyboard. Delete
 *  resolves to the delete command; arrows are pan aliases; the rest are unbound and rebindable. */
export const NAV: KeyDef[] = [
  // PrtSc is captured by the OS before the browser sees it (keydown usually never fires and the OS
  // screenshot can't be preventDefault-ed), so it is not bindable — shown fixed/muted for honesty.
  { base: 'printscreen', label: 'PrtSc', fixed: true, col: 1, row: 1 },
  NP('scrolllock', 'ScrLk', 2, 1), NP('pause', 'Pause', 3, 1),
  NP('insert', 'Ins', 1, 2), NP('home', 'Home', 2, 2), NP('pageup', 'PgUp', 3, 2),
  NP('delete', 'Del', 1, 3), NP('end', 'End', 2, 3), NP('pagedown', 'PgDn', 3, 3),
  // row 4 intentionally empty (the gap above the arrows)
  NP('arrowup', '↑', 2, 5),
  NP('arrowleft', '←', 1, 6), NP('arrowdown', '↓', 2, 6), NP('arrowright', '→', 3, 6),
];

/** The combo a key produces under the active layer, or null for a fixed key. */
export function comboFor(key: KeyDef, layer: Layer): string | null {
  if (key.fixed) return null;
  const char = layer.shift && key.shift ? key.shift : key.base;
  const parts: string[] = [];
  if (layer.ctrl) parts.push('ctrl');
  if (layer.alt) parts.push('alt');
  if (layer.shift) parts.push('shift');
  parts.push(char);
  return normalizeCombo(parts.join('+'));
}

/** Pastel keycap tint per category (distinct + cozy). */
export const CATEGORY_COLOR: Record<CommandCategory, string> = {
  surface:   '#CED779',
  tool:      '#FFDA7E',
  brush:     '#FFE196',
  layer:     '#A9D8E8',
  selection: '#FFB39A',
  camera:    '#C9BEF0',
  view:      '#8ED9C0',
  history:   '#D8D2C4',
  app:       '#F7C68C',
  overlay:   '#9FD9F0',
};

/** Order the category legend is shown in. */
export const CATEGORY_ORDER: CommandCategory[] = [
  'surface', 'tool', 'brush', 'layer', 'selection', 'camera', 'view', 'overlay', 'app', 'history',
];

/** Build a normalized combo string from a KeyboardEvent (for chord recording). Returns null for a
 *  bare modifier press. Numpad keys resolve to their own tokens via the shared `eventKeyToken`, so
 *  recording matches what the engine will dispatch. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return null;
  const char = eventKeyToken(e); // 'escape', 'backspace', 'num5', 'b', 'space', …
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(char);
  return normalizeCombo(parts.join('+'));
}

