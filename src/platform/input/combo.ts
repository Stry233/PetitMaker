/*
 * The combo grammar: a keyboard binding written as `ctrl+alt+shift+key`, lowercase, modifiers in
 * that fixed order. The keymap stores combos in this form, the shortcut engine matches presses
 * against them and every surface that prints a binding formats it here.
 */
import { eventKeyToken } from './key-token';

/** A combo taken apart: modifier flags plus the key it ends on ('' for a bare-modifier combo like
 *  `ctrl`, which carries no key of its own). */
export interface Combo { key: string; ctrl: boolean; alt: boolean; shift: boolean }

/** Canonical combo string: modifiers in a fixed order (ctrl, alt, shift), then the key, lowercase.
 *  So "Shift+G", "shift+g", "G+Shift" all normalize to "shift+g". Cmd, Meta and Control read as
 *  ctrl, Option as alt. */
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

/** The normalized combo taken apart. */
export function splitCombo(combo: string): Combo {
  const parts = normalizeCombo(combo).split('+');
  const last = parts[parts.length - 1] ?? '';
  const isMod = last === 'ctrl' || last === 'alt' || last === 'shift';
  return {
    key: isMod ? '' : last,
    ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift'),
  };
}

/** `splitCombo` reversed: the canonical string of a combo with a key. */
export function joinCombo({ key, ctrl, alt, shift }: Combo): string {
  const out: string[] = [];
  if (ctrl) out.push('ctrl');
  if (alt) out.push('alt');
  if (shift) out.push('shift');
  out.push(key);
  return out.join('+');
}

/** The key a held binding waits on: the combo's last segment. A held action ignores the modifiers
 *  before it, and a bare-modifier combo (`ctrl`) is its own held key. */
export function heldToken(combo: string): string {
  return combo.split('+').pop() ?? '';
}

const NAMED: Record<string, string> = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', escape: 'Esc', backspace: '⌫', delete: 'Del', space: 'Space',
  printscreen: 'PrtSc', scrolllock: 'ScrLk', pause: 'Pause', insert: 'Ins',
  home: 'Home', pageup: 'PgUp', pagedown: 'PgDn', end: 'End',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
};
const NUMPAD_OP: Record<string, string> = { add: '+', subtract: '−', multiply: '×', divide: '÷', decimal: '.', enter: '⏎' };

/** A combo rendered for a reader: "ctrl+shift+z" → "Ctrl Shift Z". */
export function prettyCombo(combo: string | null): string {
  if (!combo) return '';
  return combo.split('+').map((p) => {
    if (NAMED[p]) return NAMED[p];
    if (p.startsWith('arrow')) return p.slice(5).replace(/^\w/, (c) => c.toUpperCase());
    if (p.startsWith('num')) {
      const r = p.slice(3);
      return `Num ${NUMPAD_OP[r] ?? r}`;
    }
    return p.toUpperCase();
  }).join(' ');
}

/** The combo a keydown spells, or null for a press of a modifier alone. Cmd counts as Ctrl. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const k = e.key;
  if (k === 'Shift' || k === 'Control' || k === 'Alt' || k === 'Meta') return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(eventKeyToken(e));
  return normalizeCombo(parts.join('+'));
}
