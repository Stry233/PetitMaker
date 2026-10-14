/*
 * Key and mouse tokens as data, for Help's key tables and figures. A key token carries a command
 * ID, never a letter: resolution goes through effectiveCombo at render time, so a rebind reaches
 * every table with no extra wiring and an unbound command drops itself.
 */
import type { ToolbarContext } from '../../../state/keymap/toolbar';
import { effectiveCombo, type Overrides } from '../../../state/keymap/resolve';
import { heldToken, prettyCombo } from '../../../platform/input/combo';

export type MouseButton = 'none' | 'left' | 'right' | 'middle' | 'wheel';
export type MouseMark = 'drag' | 'scroll' | 'hscroll';
type Sep = 'plus' | 'or' | 'again';

export type TokenSpec =
  | { kind: 'cmd'; id: string; held?: boolean; x2?: boolean }
  | { kind: 'key'; label: string }
  | { kind: 'pan-keys' }
  | { kind: 'mouse'; button: MouseButton; mark?: MouseMark; x2?: boolean }
  | { kind: 'sep'; sep: Sep };

export type ResolvedToken =
  | { kind: 'cap'; label: string; x2?: boolean }
  /** The two move caps as one token: the letters over the fixed arrow aliases, stacked by the
   *  renderer. Side by side they are the widest thing in the panel and wrap the map rows. */
  | { kind: 'pan-stack'; letters: string }
  | { kind: 'mouse'; button: MouseButton; mark?: MouseMark; x2?: boolean }
  | { kind: 'sep'; sep: Sep };

const PAN_CMDS = ['camera.pan_up', 'camera.pan_left', 'camera.pan_down', 'camera.pan_right'] as const;

/** One combo string as caps joined by plus. A held modifier shows only its held key (the last
 *  segment), matching how the shortcut engine reads it. */
function comboTokens(combo: string, held?: boolean, x2?: boolean): ResolvedToken[] {
  const segs = held ? [heldToken(combo)] : combo.split('+');
  const out: ResolvedToken[] = [];
  segs.forEach((seg, i) => {
    if (i > 0) out.push({ kind: 'sep', sep: 'plus' });
    out.push({ kind: 'cap', label: prettyCombo(seg), x2: x2 && i === segs.length - 1 ? true : undefined });
  });
  return out;
}

function panKeyToken(overrides: Overrides): ResolvedToken | null {
  const letters: string[] = [];
  for (const id of PAN_CMDS) {
    const combo = effectiveCombo(overrides, id);
    if (!combo) return null;
    letters.push(prettyCombo(heldToken(combo)));
  }
  return { kind: 'pan-stack', letters: letters.join('') };
}

/**
 * One row of token specs resolved against the live keymap, so Help's tables and figures can never
 * disagree about what a command is bound to.
 *
 * Specs resolve independently: an unbound `cmd`/`pan-keys` token drops only itself, never its row.
 * The row as a whole returns null only when it wanted at least one key token and none resolved
 * (nothing left to show). A separator left dangling by a dropped neighbour is stripped.
 */
export function resolveTokenSpecs(specs: readonly TokenSpec[], overrides: Overrides, context?: ToolbarContext): ResolvedToken[] | null {
  const slots: (ResolvedToken[] | null)[] = [];
  let wanted = 0, resolved = 0;
  for (const t of specs) {
    if (t.kind === 'cmd') {
      wanted++;
      const combo = effectiveCombo(overrides, t.id, context);
      if (!combo) { slots.push(null); continue; }
      resolved++;
      slots.push(comboTokens(combo, t.held, t.x2));
    } else if (t.kind === 'pan-keys') {
      wanted++;
      const pan = panKeyToken(overrides);
      if (!pan) { slots.push(null); continue; }
      resolved++;
      slots.push([pan]);
    } else if (t.kind === 'key') {
      slots.push([{ kind: 'cap', label: t.label }]);
    } else {
      slots.push([t]);
    }
  }
  if (wanted > 0 && resolved === 0) return null;
  const tokens: ResolvedToken[] = [];
  for (const s of slots) {
    if (!s) continue;
    const isSep = s.length === 1 && s[0]!.kind === 'sep';
    if (isSep && (tokens.length === 0 || tokens[tokens.length - 1]!.kind === 'sep')) continue;
    tokens.push(...s);
  }
  while (tokens.length && tokens[tokens.length - 1]!.kind === 'sep') tokens.pop();
  return tokens;
}
