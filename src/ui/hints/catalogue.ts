/*
 * The hint content as data. A key token carries a COMMAND ID, never a letter: resolution goes
 * through effectiveCombo at render time, so a rebind reaches the panel with no extra wiring and
 * an unbound command drops its whole row. Camera rows carry a VERB, not copy: the text key is
 * chosen by navDragVerb/wheelVerb from the live camera caps, the same functions the pointer
 * machine uses, so the panel cannot promise a gesture the view will not honor.
 */
import { navDragVerb, wheelVerb, type CameraCaps } from '../../core/interaction/camera-verbs';
import { effectiveCombo, type Overrides } from '../../core/runtime/keybindings';
import { prettyCombo } from '../../core/runtime/keybindings';
import type { HintScenarioId } from './scenario';

export type MouseButton = 'none' | 'left' | 'right' | 'middle' | 'wheel';
export type MouseMark = 'drag' | 'scroll' | 'hscroll';
type Sep = 'plus' | 'or' | 'again';

export type TokenSpec =
  | { kind: 'cmd'; id: string; held?: boolean; x2?: boolean }
  | { kind: 'key'; label: string }
  | { kind: 'pan-keys' }
  | { kind: 'mouse'; button: MouseButton; mark?: MouseMark; x2?: boolean }
  | { kind: 'sep'; sep: Sep };

export type CameraRowVerb = 'nav-drag' | 'scroll' | 'horizontal';

export interface HintRow {
  tokens: readonly TokenSpec[];
  textKey?: string;
  cameraVerb?: CameraRowVerb;
}

export type ResolvedToken =
  | { kind: 'cap'; label: string; x2?: boolean }
  /** The two move caps as ONE token: the letters over the fixed arrow aliases, stacked by the
   *  renderer. Side by side they are the widest thing in the panel and wrap the map rows. */
  | { kind: 'pan-stack'; letters: string }
  | { kind: 'mouse'; button: MouseButton; mark?: MouseMark; x2?: boolean }
  | { kind: 'sep'; sep: Sep };

export interface ResolvedRow { tokens: readonly ResolvedToken[]; textKey: string }

const cmd = (id: string, o?: { held?: boolean; x2?: boolean }): TokenSpec => ({ kind: 'cmd', id, ...o });
const key = (label: string): TokenSpec => ({ kind: 'key', label });
const mouse = (button: MouseButton, mark?: MouseMark, x2?: boolean): TokenSpec => ({ kind: 'mouse', button, mark, x2 });
const sep = (s: Sep): TokenSpec => ({ kind: 'sep', sep: s });
const panKeys: TokenSpec = { kind: 'pan-keys' };

export const SCENARIO_ROWS: Record<HintScenarioId, readonly HintRow[]> = {
  'map-2d': [
    { tokens: [mouse('right', 'drag'), sep('or'), panKeys], cameraVerb: 'nav-drag' },
    { tokens: [cmd('tool.constrain', { held: true }), sep('plus'), panKeys], textKey: 'hint.map2d.slow' },
    { tokens: [cmd('camera.pan_up', { held: true, x2: true })], textKey: 'hint.map2d.fast' },
    { tokens: [key('Ctrl'), sep('plus'), mouse('wheel', 'scroll')], textKey: 'hint.map2d.zoom' },
    { tokens: [cmd('selection.multi', { held: true }), sep('plus'), mouse('left', 'drag')], textKey: 'hint.map2d.band' },
    { tokens: [cmd('view.toggle')], textKey: 'hint.map2d.to3d' },
  ],
  'map-3d': [
    { tokens: [mouse('right', 'drag')], cameraVerb: 'nav-drag' },
    { tokens: [mouse('left', 'drag'), sep('or'), panKeys], textKey: 'hint.camera.pan' },
    { tokens: [mouse('wheel', 'scroll')], cameraVerb: 'scroll' },
    { tokens: [mouse('wheel', 'hscroll')], cameraVerb: 'horizontal' },
    { tokens: [cmd('view.toggle')], textKey: 'hint.map3d.to2d' },
  ],
  build: [
    { tokens: [cmd('tool.constrain', { held: true }), sep('plus'), mouse('left', 'drag')], textKey: 'hint.build.constrain' },
    { tokens: [cmd('brush.smaller'), cmd('brush.bigger')], textKey: 'hint.build.size' },
    { tokens: [cmd('layer.up'), cmd('layer.down')], textKey: 'hint.build.layer' },
    { tokens: [cmd('camera.pan_drag', { held: true }), sep('plus'), mouse('left', 'drag')], textKey: 'hint.camera.pan' },
    { tokens: [cmd('selection.multi', { held: true }), sep('plus'), mouse('left', 'drag')], textKey: 'hint.build.select' },
    { tokens: [cmd('surface.mountain'), cmd('surface.river'), cmd('surface.road')], textKey: 'hint.build.surface' },
  ],
  eraser: [
    { tokens: [mouse('left', 'drag')], textKey: 'hint.eraser.erase' },
    { tokens: [cmd('surface.road')], textKey: 'hint.eraser.road' },
    { tokens: [cmd('brush.smaller'), cmd('brush.bigger')], textKey: 'hint.build.size' },
    { tokens: [cmd('camera.pan_drag', { held: true }), sep('plus'), mouse('left', 'drag')], textKey: 'hint.camera.pan' },
  ],
  'edge-cut': [
    { tokens: [mouse('left')], textKey: 'hint.edgecut.click' },
    { tokens: [mouse('left'), sep('again')], textKey: 'hint.edgecut.cycle' },
    { tokens: [mouse('left')], textKey: 'hint.edgecut.road' },
    { tokens: [cmd('camera.pan_drag', { held: true }), sep('plus'), mouse('left', 'drag')], textKey: 'hint.camera.pan' },
  ],
  'curve-draw': [
    { tokens: [mouse('left')], textKey: 'hint.curve.add' },
    { tokens: [mouse('left', 'drag')], textKey: 'hint.curve.move' },
    { tokens: [mouse('left', undefined, true)], textKey: 'hint.curve.finish' },
    { tokens: [cmd('selection.delete')], textKey: 'hint.curve.undo' },
    { tokens: [cmd('selection.deselect')], textKey: 'hint.curve.cancel' },
  ],
  'curve-adjust': [
    { tokens: [mouse('left', 'drag')], textKey: 'hint.curve.bend' },
    { tokens: [cmd('tool.break_handle', { held: true }), sep('plus'), mouse('left', 'drag')], textKey: 'hint.curve.break' },
    { tokens: [mouse('left', 'drag')], textKey: 'hint.curve.anchor' },
    { tokens: [mouse('left')], textKey: 'hint.curve.done' },
  ],
  placer: [
    { tokens: [cmd('selection.rotate_cw'), cmd('selection.rotate_ccw')], textKey: 'hint.placer.rotate' },
    { tokens: [cmd('selection.multi', { held: true }), sep('plus'), mouse('left', 'drag')], textKey: 'hint.build.select' },
    { tokens: [mouse('left')], textKey: 'hint.placer.blocked' },
    { tokens: [cmd('selection.deselect')], textKey: 'hint.placer.away' },
  ],
  'span-placer': [
    { tokens: [mouse('none', 'drag')], textKey: 'hint.span.hover' },
    { tokens: [], textKey: 'hint.span.auto' },
    { tokens: [], textKey: 'hint.span.ghost' },
    { tokens: [cmd('selection.deselect')], textKey: 'hint.placer.away' },
  ],
  'selection-one': [
    { tokens: [mouse('left', 'drag')], textKey: 'hint.sel.move' },
    { tokens: [cmd('selection.rotate_cw'), cmd('selection.rotate_ccw')], textKey: 'hint.sel.rotate' },
    { tokens: [cmd('selection.delete')], textKey: 'hint.sel.delete' },
    { tokens: [mouse('right')], textKey: 'hint.sel.menu' },
    { tokens: [cmd('selection.multi', { held: true }), sep('plus'), mouse('left')], textKey: 'hint.sel.add' },
  ],
  // No right-click row: the context menu's terrain branch holds Delete alone, which is the row
  // above it.
  'selection-terrain': [
    { tokens: [cmd('selection.delete')], textKey: 'hint.selterrain.delete' },
    { tokens: [cmd('selection.deselect')], textKey: 'hint.sel.deselect' },
  ],
  'selection-many': [
    { tokens: [mouse('left', 'drag')], textKey: 'hint.selmany.move' },
    { tokens: [cmd('selection.rotate_cw'), cmd('selection.rotate_ccw')], textKey: 'hint.selmany.rotate' },
    { tokens: [cmd('selection.delete')], textKey: 'hint.selmany.delete' },
    { tokens: [mouse('left')], textKey: 'hint.selmany.collapse' },
  ],
  region: [
    { tokens: [mouse('left', 'drag')], textKey: 'hint.region.paint' },
    { tokens: [cmd('history.undo')], textKey: 'hint.region.undo' },
    { tokens: [], textKey: 'hint.region.scope' },
  ],
};

const PAN_CMDS = ['camera.pan_up', 'camera.pan_left', 'camera.pan_down', 'camera.pan_right'] as const;

function cameraRowTextKey(verb: CameraRowVerb, caps: CameraCaps): string | null {
  if (verb === 'nav-drag') return navDragVerb(caps) === 'orbit' ? 'hint.camera.orbit' : 'hint.camera.pan';
  if (verb === 'scroll') return wheelVerb('scroll', caps) === 'zoom-smooth' ? 'hint.camera.dolly' : null;
  return wheelVerb('horizontal', caps) === 'yaw' ? 'hint.camera.yaw' : null;
}

/** One combo string as caps joined by plus. A held modifier shows only its held key (the last
 *  segment), matching how the shortcut engine reads it. */
function comboTokens(combo: string, held?: boolean, x2?: boolean): ResolvedToken[] {
  const segs = held ? [combo.split('+').pop()!] : combo.split('+');
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
    letters.push(prettyCombo(combo.split('+').pop()!));
  }
  return { kind: 'pan-stack', letters: letters.join('') };
}

/** How many rows 'concise' keeps. The panel needs the cut itself (it renders the rows past it and
 *  fades them out as the card collapses), so the number lives here rather than in the slice below. */
export const CONCISE_ROWS = 3;

/** A row's spec tokens resolve independently: an unbound `cmd`/`pan-keys` token drops ONLY itself,
 *  never its row, so a paired hint (e.g. rotate cw/ccw) still shows the half that is bound. The row
 *  as a whole drops only when it wanted at least one key token and NONE of them resolved (nothing
 *  left to show). A separator left dangling by a dropped neighbour (leading, trailing, or doubled)
 *  is stripped in the assembly pass below. */
export function rowsFor(id: HintScenarioId, overrides: Overrides, caps: CameraCaps, level: 'full' | 'concise'): ResolvedRow[] {
  const rows: ResolvedRow[] = [];
  for (const row of SCENARIO_ROWS[id]) {
    const textKey = row.cameraVerb ? cameraRowTextKey(row.cameraVerb, caps) : row.textKey!;
    if (!textKey) continue;
    const slots: (ResolvedToken[] | null)[] = [];
    let wanted = 0, resolved = 0;
    for (const t of row.tokens) {
      if (t.kind === 'cmd') {
        wanted++;
        const combo = effectiveCombo(overrides, t.id);
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
    if (wanted > 0 && resolved === 0) continue; // no key token survived — nothing left to show
    const tokens: ResolvedToken[] = [];
    for (const s of slots) {
      if (!s) continue;
      const isSep = s.length === 1 && s[0]!.kind === 'sep';
      if (isSep && (tokens.length === 0 || tokens[tokens.length - 1]!.kind === 'sep')) continue;
      tokens.push(...s);
    }
    while (tokens.length && tokens[tokens.length - 1]!.kind === 'sep') tokens.pop();
    rows.push({ tokens, textKey });
  }
  return level === 'concise' ? rows.slice(0, CONCISE_ROWS) : rows;
}
