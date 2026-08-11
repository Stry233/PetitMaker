/**
 * The keybinding registry is the single source of truth, so guard its invariants + the pure override
 * logic (resolution, conflict/steal, reserved protection, persistence). The visual keyboard page
 * reads all of this, so a broken invariant would surface as a wrong/unbindable key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { COMMANDS, COMMAND_BY_ID } from '../../kit/commands';
import {
  ALIASES, normalizeCombo, effectiveCombo, bindingIndex, aliasIndex, isReservedCombo, useKeybinds, META_BY_ID,
  type Overrides,
} from '../../core/runtime/keybindings';
import { KEY_ROWS, NAV, NUMPAD, comboFor, comboFromEvent, type Layer } from '../../ui/chrome/modals/keyboard/layout';
import { prettyCombo } from '../../core/runtime/keybindings';
import { translations } from '../../i18n/translations';
import { useEditorStore } from '../../state/store';
import { setStoreState } from '../_store';
import type { EditorEvents } from '../../core/model/types';
import { makeState, makeObject } from '../rules/_helpers';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { roadLookup } from '../../state/object-index';

const noopCtx = { openBuild: () => {}, handleTileAction: () => {}, toggleMenu: () => {} };

describe('command registry (single source of truth)', () => {
  it('has unique ids', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every label resolves in all 7 locales', () => {
    for (const cmd of COMMANDS) {
      for (const [loc, dict] of Object.entries(translations)) {
        expect(dict[cmd.labelKey], `${cmd.id} → ${cmd.labelKey} missing in ${loc}`).toBeTruthy();
      }
    }
  });

  it('default combos are unique among mapped commands', () => {
    const combos = COMMANDS.map((c) => c.defaultCombo).filter((c): c is string => !!c).map(normalizeCombo);
    expect(new Set(combos).size, 'duplicate default combos').toBe(combos.length);
  });

  it('routes the menu toggle through the host, not straight at the store', () => {
    // Whether the menu is open is the shell's own React state, not a store field, so a command
    // cannot reach it directly: it has to go through the context the shell supplies.
    const toggleMenu = vi.fn();
    COMMAND_BY_ID.get('app.menu')!.run({ ...noopCtx, toggleMenu });
    expect(toggleMenu).toHaveBeenCalledTimes(1);
  });

  it('marks undo/redo reserved', () => {
    expect(COMMAND_BY_ID.get('history.undo')?.reserved).toBe(true);
    expect(COMMAND_BY_ID.get('history.redo')?.reserved).toBe(true);
  });

  describe('history.undo/redo route to the region brush while selecting a region', () => {
    const executor = new CommandExecutor(makeState(), new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(makeState()));

    afterEach(() => {
      setStoreState({ selectingRegion: false, commandExecutor: null });
      vi.restoreAllMocks();
    });

    it('Ctrl+Z calls the region undo, never the map executor, while selectingRegion is on', () => {
      const executorUndo = vi.spyOn(executor, 'undo');
      setStoreState({ selectingRegion: true, commandExecutor: executor });
      const regionUndo = vi.fn(() => true);
      COMMAND_BY_ID.get('history.undo')!.run({ ...noopCtx, regionUndo });
      expect(regionUndo).toHaveBeenCalledTimes(1);
      expect(executorUndo).not.toHaveBeenCalled();
    });

    it('an empty region-undo stack still does not fall through to the map executor', () => {
      const executorUndo = vi.spyOn(executor, 'undo');
      setStoreState({ selectingRegion: true, commandExecutor: executor });
      const regionUndo = vi.fn(() => false); // nothing left to undo
      COMMAND_BY_ID.get('history.undo')!.run({ ...noopCtx, regionUndo });
      expect(regionUndo).toHaveBeenCalledTimes(1);
      expect(executorUndo).not.toHaveBeenCalled(); // still a no-op, not a map edit
    });

    it('Ctrl+Z reaches the map executor as usual once selectingRegion is off', () => {
      const executorUndo = vi.spyOn(executor, 'undo').mockImplementation(() => false);
      setStoreState({ selectingRegion: false, commandExecutor: executor });
      const regionUndo = vi.fn(() => true);
      COMMAND_BY_ID.get('history.undo')!.run({ ...noopCtx, regionUndo });
      expect(executorUndo).toHaveBeenCalledTimes(1);
      expect(regionUndo).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+Z mirrors the same routing for redo', () => {
      const executorRedo = vi.spyOn(executor, 'redo').mockImplementation(() => {});
      setStoreState({ selectingRegion: true, commandExecutor: executor });
      const regionRedo = vi.fn(() => true);
      COMMAND_BY_ID.get('history.redo')!.run({ ...noopCtx, regionRedo });
      expect(regionRedo).toHaveBeenCalledTimes(1);
      expect(executorRedo).not.toHaveBeenCalled();
    });
  });

  it('every alias targets a real command', () => {
    for (const a of ALIASES) expect(COMMAND_BY_ID.has(a.commandId), a.commandId).toBe(true);
  });

  it('the shape-constrain modifier is a continuous command defaulting to Shift', () => {
    const c = COMMAND_BY_ID.get('tool.constrain');
    expect(c?.continuous).toBe(true);
    expect(c?.defaultCombo).toBe('shift');
  });

  it('declares both Ctrl bindings so they appear in the keyboard modal and are rebindable', () => {
    const multi = COMMANDS.find((c) => c.id === 'selection.multi')!;
    expect(multi.defaultCombo).toBe('ctrl');
    expect(multi.continuous).toBe(true); // held, so the discrete engine skips it
    expect(multi.category).toBe('selection');
    const all = COMMANDS.find((c) => c.id === 'selection.all')!;
    expect(all.defaultCombo).toBe('ctrl+a');
    expect(all.continuous).toBeFalsy();
    expect(all.category).toBe('selection');
  });

  it('selection.all REPLACES the selection with every object incl. locked ones, and no terrain', () => {
    const state = makeState();
    state.objects.set('a', makeObject('a', 1, 1));
    state.objects.set('plaza', { ...makeObject('plaza', 5, 5), locked: true });
    // Start from a non-empty, non-matching selection: an implementation that
    // APPENDED instead of replacing would leave this terrain ref behind.
    useEditorStore.setState({ gridState: state, selection: [{ kind: 'terrain', x: 9, y: 9 }] });
    try {
      COMMAND_BY_ID.get('selection.all')!.run(noopCtx);
      const sel = useEditorStore.getState().selection;
      expect(sel.every((r) => r.kind === 'object')).toBe(true);
      expect(sel.map((r) => r.kind === 'object' && r.id).sort()).toEqual(['a', 'plaza']);
    } finally {
      useEditorStore.setState({ gridState: null, selection: [] }); // don't leak into later tests
    }
  });
});

describe('keyboard layout', () => {
  const BASE: Layer = { ctrl: false, alt: false, shift: false };

  it('never binds a fixed (modifier/space) key', () => {
    for (const row of KEY_ROWS) for (const k of row) if (k.fixed) expect(comboFor(k, BASE)).toBeNull();
  });

  it('resolves the same combos the registry ships (per active layer)', () => {
    const e = KEY_ROWS.flat().find((k) => k.base === 'e')!;
    const g = KEY_ROWS.flat().find((k) => k.base === 'g')!;
    const slash = KEY_ROWS.flat().find((k) => k.base === '/')!;
    const idx = bindingIndex({});
    expect(idx.get(comboFor(e, BASE)!)).toBe('selection.rotate_cw');
    expect(idx.get(comboFor(g, { ...BASE, ctrl: true })!)).toBe('app.generate');
    // Shift+/ produces "?", the chord notation the layout renders for that combo.
    expect(comboFor(slash, { ...BASE, shift: true })).toBe('shift+?');
  });

  it('a shift-modified combo still resolves through bindingIndex, via an explicit override (no command sits on a shift layer under the game default, so this pins the KeyDef.shift path directly)', () => {
    const g = KEY_ROWS.flat().find((k) => k.base === 'g')!;
    const idx = bindingIndex({ 'overlay.grid': 'shift+g' });
    expect(idx.get(comboFor(g, { ...BASE, shift: true })!)).toBe('overlay.grid');
  });

  it('the Shift keys carry the rebindable constrain command', () => {
    const shifts = KEY_ROWS.flat().filter((k) => k.base === 'shift');
    expect(shifts.length).toBe(2);
    const idx = bindingIndex({});
    for (const s of shifts) expect(idx.get(comboFor(s, BASE)!)).toBe('tool.constrain');
  });

  it('every modifier keycap reports the layer it represents, so it can light up when engaged', () => {
    // Shift holds a command (constrain) so it is NOT a `mod` toggle like Ctrl/Alt; it must still
    // declare `layerOf` or it can never highlight — including in ctrl+shift / alt+shift combos.
    for (const k of KEY_ROWS.flat()) {
      if (!['shift', 'ctrl', 'alt'].includes(k.base)) continue;
      const represents = k.mod ?? k.layerOf;
      expect(represents, `${k.base} keycap represents no layer`).toBe(k.base);
    }
  });

  it('the nav + numpad clusters expose the requested bindable keys', () => {
    const navTokens = new Set(NAV.map((k) => k.base));
    for (const t of ['printscreen', 'pause', 'insert', 'home', 'pageup', 'pagedown', 'end', 'delete',
      'arrowup', 'arrowdown', 'arrowleft', 'arrowright']) {
      expect(navTokens.has(t), `nav missing ${t}`).toBe(true);
    }
    // Delete resolves to the delete command; the numpad carries num0..num9.
    expect(bindingIndex({}).get('delete')).toBe('selection.delete');
    for (let d = 0; d <= 9; d++) expect(NUMPAD.some((k) => k.base === `num${d}`)).toBe(true);
    // Grid keys carry a placement; the tall +/Enter span 2 rows, the wide 0 spans 2 cols.
    expect(NUMPAD.find((k) => k.base === 'numadd')?.rowSpan).toBe(2);
    expect(NUMPAD.find((k) => k.base === 'numenter')?.rowSpan).toBe(2);
    expect(NUMPAD.find((k) => k.base === 'num0')?.colSpan).toBe(2);
  });

  it('arrow keys are pan aliases (shown on the keyboard, not in the editable index)', () => {
    const a = aliasIndex();
    expect(a.get('arrowup')).toBe('camera.pan_up');
    expect(a.get('arrowdown')).toBe('camera.pan_down');
    expect(a.get('arrowleft')).toBe('camera.pan_left');
    expect(a.get('arrowright')).toBe('camera.pan_right');
    // They are fixed aliases, not user-editable primaries, so they are NOT in the bindingIndex; the
    // keyboard page has to fall back to aliasIndex or an arrow key renders blank.
    expect(bindingIndex({}).has('arrowup')).toBe(false);
  });

  it('has an Esc + F1-F12 function row; browser-reserved F-keys + PrintScreen are non-bindable', () => {
    const fkeys = new Map(KEY_ROWS.flat().filter((k) => /^f\d+$/.test(k.base)).map((k) => [k.base, k]));
    for (let n = 1; n <= 12; n++) expect(fkeys.has(`f${n}`), `missing f${n}`).toBe(true);
    // Browser-reserved (Help/Find/Reload/AddrBar/Fullscreen/DevTools) → shown but not bindable.
    for (const t of ['f1', 'f3', 'f5', 'f6', 'f11', 'f12']) expect(fkeys.get(t)?.fixed, t).toBe(true);
    for (const t of ['f2', 'f4', 'f7', 'f8', 'f9', 'f10']) expect(fkeys.get(t)?.fixed, t).toBeFalsy();
    // PrtSc is OS-captured -> shown but not bindable.
    expect(NAV.find((k) => k.base === 'printscreen')?.fixed).toBe(true);
    // Arrows sit at the BOTTOM of the nav cluster (a gap row above them) so its bottom aligns.
    expect(NAV.find((k) => k.base === 'arrowup')?.row).toBe(5);
    expect(NAV.find((k) => k.base === 'arrowdown')?.row).toBe(6);
  });

  it('comboFromEvent lowercases letters and orders modifiers, ignoring bare modifiers', () => {
    const ev = (init: Partial<KeyboardEvent>): KeyboardEvent => init as KeyboardEvent;
    expect(comboFromEvent(ev({ key: 'B' }))).toBe('b');
    expect(comboFromEvent(ev({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+z');
    expect(comboFromEvent(ev({ key: 'Shift', shiftKey: true }))).toBeNull();
    // The pan-hold gesture is a bound command like any other, so its key records like any other.
    expect(comboFromEvent(ev({ key: ' ' }))).toBe('space');
  });

  it('records an AZERTY digit-row press as its physical digit (shares eventKeyToken with the engine)', () => {
    const ev = (init: Partial<KeyboardEvent>): KeyboardEvent => init as KeyboardEvent;
    expect(comboFromEvent(ev({ key: '&', code: 'Digit1' }))).toBe('1');
    expect(comboFromEvent(ev({ key: '?', shiftKey: true, code: 'Digit1' }))).toBe('shift+?');
  });

  it('numpad keys bind independently of the top-row digits (via event.code)', () => {
    const ev = (init: Partial<KeyboardEvent>): KeyboardEvent => init as KeyboardEvent;
    expect(comboFromEvent(ev({ key: '5', code: 'Numpad5' }))).toBe('num5');
    expect(comboFromEvent(ev({ key: '5', code: 'Digit5' }))).toBe('5');
    expect(comboFromEvent(ev({ key: '+', code: 'NumpadAdd', ctrlKey: true }))).toBe('ctrl+numadd');
    // NumLock-off nav keys still resolve to the numpad token (code, not key).
    expect(comboFromEvent(ev({ key: 'Home', code: 'Numpad7' }))).toBe('num7');
  });

  it('prettyCombo renders human labels incl. numpad', () => {
    expect(prettyCombo('ctrl+shift+z')).toBe('Ctrl Shift Z');
    expect(prettyCombo('escape')).toBe('Esc');
    expect(prettyCombo('num5')).toBe('Num 5');
    expect(prettyCombo('numadd')).toBe('Num +');
    expect(prettyCombo('pageup')).toBe('PgUp');
    expect(prettyCombo('arrowleft')).toBe('←');
    expect(prettyCombo('ctrl+home')).toBe('Ctrl Home');
    expect(prettyCombo(null)).toBe('');
  });
});

describe('the pan-drag key', () => {
  it('is a held command like the other three modifiers', () => {
    const cmd = COMMAND_BY_ID.get('camera.pan_drag');
    expect(cmd?.continuous).toBe(true);
    expect(cmd?.defaultCombo).toBe('space');
  });

  it('is rebindable, so Space can be recorded as a combo', () => {
    expect(isReservedCombo('space')).toBe(false);
  });
});

describe('combo normalization', () => {
  it('orders modifiers and lowercases', () => {
    expect(normalizeCombo('Shift+G')).toBe('shift+g');
    expect(normalizeCombo('G')).toBe('g');
    expect(normalizeCombo('shift+ctrl+Z')).toBe('ctrl+shift+z');
    expect(normalizeCombo('Cmd+K')).toBe('ctrl+k');
  });
});

describe('effective resolution', () => {
  it('uses the default when unset, the override when set, and null when explicitly unbound', () => {
    expect(effectiveCombo({}, 'tool.brush')).toBe('1');
    expect(effectiveCombo({ 'tool.brush': 'j' }, 'tool.brush')).toBe('j');
    expect(effectiveCombo({ 'tool.brush': null }, 'tool.brush')).toBeNull();
  });
  it('ignores overrides on reserved commands', () => {
    expect(effectiveCombo({ 'history.undo': 'j' }, 'history.undo')).toBe('ctrl+z');
  });
  it('bindingIndex maps effective combos to ids', () => {
    const idx = bindingIndex({});
    expect(idx.get('1')).toBe('tool.brush');
    expect(idx.get('e')).toBe('selection.rotate_cw');
    expect(idx.get('ctrl+z')).toBe('history.undo');
  });
  it('flags reserved combos', () => {
    expect(isReservedCombo('ctrl+z')).toBe(true);
    expect(isReservedCombo('b')).toBe(false);
  });
});

describe('rebind store', () => {
  beforeEach(() => useKeybinds.getState().resetAll());

  const eff = (id: string): string | null => effectiveCombo(useKeybinds.getState().overrides, id);

  it('assigns a free combo', () => {
    const r = useKeybinds.getState().rebind('tool.brush', 'j');
    expect(r.ok).toBe(true);
    expect(r.displaced).toBeUndefined();
    expect(eff('tool.brush')).toBe('j');
  });

  it('steals the combo from the prior holder (which becomes unbound)', () => {
    // '2' is eraser's default; give it to the brush → eraser loses it.
    const r = useKeybinds.getState().rebind('tool.brush', '2');
    expect(r.ok).toBe(true);
    expect(r.displaced).toBe('tool.eraser');
    expect(eff('tool.brush')).toBe('2');
    expect(eff('tool.eraser')).toBeNull();
  });

  it('assigning a command its own default drops the override', () => {
    useKeybinds.getState().rebind('tool.brush', 'j');
    useKeybinds.getState().rebind('tool.brush', '1'); // back to default
    expect('tool.brush' in useKeybinds.getState().overrides).toBe(false);
    expect(eff('tool.brush')).toBe('1');
  });

  it('refuses to rebind a reserved command or steal a reserved combo', () => {
    expect(useKeybinds.getState().rebind('history.undo', 'j').ok).toBe(false);
    expect(useKeybinds.getState().rebind('tool.brush', 'ctrl+z').ok).toBe(false);
    expect(eff('tool.brush')).toBe('1'); // unchanged
  });

  it('clear unbinds, resetAll restores defaults', () => {
    useKeybinds.getState().clear('tool.brush');
    expect(eff('tool.brush')).toBeNull();
    useKeybinds.getState().resetAll();
    expect(eff('tool.brush')).toBe('1');
    expect(useKeybinds.getState().overrides).toEqual({});
  });

  it('persists overrides to localStorage', () => {
    useKeybinds.getState().rebind('tool.brush', 'j');
    const raw = localStorage.getItem('petit-planet-keybinds');
    expect(raw && (JSON.parse(raw) as Overrides)['tool.brush']).toBe('j');
  });
});

describe('UI zoom is registered, reserved, and matches its listener', () => {
  it('declares both rows reserved on the combos the listener answers', () => {
    for (const [id, combo] of [['app.ui_zoom_in', 'ctrl+='], ['app.ui_zoom_out', 'ctrl+-']] as const) {
      const meta = META_BY_ID.get(id);
      expect(meta?.reserved, id).toBe(true);
      expect(meta?.defaultCombo, id).toBe(combo);
    }
  });
  it('the combos cannot be stolen by a rebind', () => {
    expect(useKeybinds.getState().rebind('tool.brush', 'ctrl+=').ok).toBe(false);
  });
  it('a shifted variant the listener also answers is reserved too', () => {
    expect(useKeybinds.getState().rebind('tool.brush', 'ctrl+shift+=').ok).toBe(false);
  });
  it('labels resolve in all 7 locales', () => {
    for (const id of ['app.ui_zoom_in', 'app.ui_zoom_out']) {
      const key = META_BY_ID.get(id)!.labelKey;
      for (const [loc, d] of Object.entries(translations)) expect(d[key], `${id} in ${loc}`).toBeTruthy();
    }
  });
});
