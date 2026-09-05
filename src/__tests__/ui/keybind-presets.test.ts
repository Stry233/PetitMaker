/**
 * Keymap presets ("shortcut styles") + JSON import/export. A preset must be internally valid (unique
 * combo per command) or applying it would leave a broken keymap; import must reject conflicts so a
 * crafted/edited file can't collide two commands onto one key. Pure logic, unit-tested directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PRESETS, presetBinds, detectPreset, serializeKeybinds, parseKeybinds, useKeybinds, effectiveCombo,
  normalizeCombo,
} from '../../core/runtime/keybindings';
import { translations } from '../../i18n/translations';

describe('keymap presets', () => {
  it('every preset assigns a unique combo per command (internally valid)', () => {
    for (const p of PRESETS) {
      const combos = [...presetBinds(p).values()].filter((c): c is string => c != null);
      expect(new Set(combos).size, `${p.id} has duplicate combos`).toBe(combos.length);
    }
  });

  it('preset labels resolve in all 7 locales', () => {
    for (const p of PRESETS)
      for (const [loc, d] of Object.entries(translations)) expect(d[p.labelKey], `${p.id} in ${loc}`).toBeTruthy();
  });

  it('the numeric preset is meaningfully different from default', () => {
    const def = presetBinds(PRESETS.find((p) => p.id === 'default')!);
    const num = presetBinds(PRESETS.find((p) => p.id === 'numeric')!);
    let diffs = 0;
    for (const [k, v] of num) if (def.get(k) !== v) diffs++;
    expect(diffs).toBeGreaterThanOrEqual(10);
  });

  it('pro reproduces the pre-game-layout defaults exactly', () => {
    const pro = presetBinds(PRESETS.find((p) => p.id === 'pro')!);
    // The frozen 2026-08-09 shipped layout. This fixture is history, not derivation:
    // if it fails, the PRO map drifted, not this list.
    const frozen: Record<string, string> = {
      'surface.mountain': '1', 'surface.river': '2', 'surface.road': '3',
      'tool.move': 'v', 'tool.brush': 'b', 'tool.eraser': 'e', 'tool.rect': 'r',
      'tool.circle': 'c', 'tool.line': 'f', 'tool.curve': 'g', 'tool.edgecut': 'x', 'tool.smart': 't',
      'tool.constrain': 'shift', 'tool.break_handle': 'alt',
      'brush.bigger': ']', 'brush.smaller': '[', 'layer.up': 'q', 'layer.down': 'z',
      'selection.rotate_cw': '.', 'selection.rotate_ccw': ',', 'selection.delete': 'delete',
      'selection.deselect': 'escape', 'selection.multi': 'ctrl', 'selection.all': 'ctrl+a',
      'camera.zoom_in': '=', 'camera.zoom_out': '-', 'camera.fit': 'ctrl+0',
      'camera.pan_up': 'w', 'camera.pan_left': 'a', 'camera.pan_down': 's', 'camera.pan_right': 'd',
      'camera.pan_drag': 'space', 'view.toggle': '`',
      'app.generate': 'ctrl+g', 'app.new': 'ctrl+alt+n', 'app.export_json': 'ctrl+s',
      'app.export_image': 'ctrl+p', 'app.help': 'shift+?', 'app.menu': 'm',
      'overlay.grid': 'shift+g', 'overlay.numbers': 'shift+n', 'overlay.chunks': 'shift+c',
    };
    for (const [id, combo] of Object.entries(frozen))
      expect(pro.get(id), id).toBe(normalizeCombo(combo));
  });

  it('the game default arms the terrain bar row on 1-8 and rotate on E', () => {
    const expects: Record<string, string | null> = {
      'tool.brush': '1', 'tool.eraser': '2', 'tool.edgecut': '3', 'tool.line': '4',
      'tool.curve': '5', 'tool.rect': '6', 'tool.circle': '7', 'tool.smart': '8',
      'selection.rotate_cw': 'e', 'selection.rotate_ccw': null,
      'surface.mountain': null, 'tool.move': null, 'camera.pan_up': 'w',
    };
    for (const [id, combo] of Object.entries(expects)) expect(effectiveCombo({}, id), id).toBe(combo);
  });
});

describe('preset apply + detect', () => {
  beforeEach(() => useKeybinds.getState().resetAll());
  const ov = (): Record<string, string | null> => useKeybinds.getState().overrides;

  it('detects default with no overrides', () => {
    expect(detectPreset({})).toBe('default');
  });

  it('applyBinds(preset) makes detectPreset return that preset, for every preset', () => {
    for (const p of PRESETS) {
      useKeybinds.getState().applyBinds(p.binds);
      expect(detectPreset(ov()), p.id).toBe(p.id);
    }
    // numeric keeps the game default's digits and moves pan to the arrows; spot-check both, and
    // that move carries no number (it inherits Pro's letter through the spread).
    useKeybinds.getState().applyBinds(PRESETS.find((p) => p.id === 'numeric')!.binds);
    expect(effectiveCombo(ov(), 'tool.brush')).toBe('1');
    expect(effectiveCombo(ov(), 'tool.smart')).toBe('8');
    expect(effectiveCombo(ov(), 'tool.move')).toBe('v');
    expect(effectiveCombo(ov(), 'camera.pan_up')).toBe('arrowup');
  });

  it('a hand-edit reads as custom', () => {
    useKeybinds.getState().rebind('tool.brush', 'k');
    expect(detectPreset(ov())).toBe('custom');
  });

  it('re-applying default clears every override', () => {
    useKeybinds.getState().applyBinds(PRESETS.find((p) => p.id === 'numeric')!.binds);
    useKeybinds.getState().applyBinds(PRESETS.find((p) => p.id === 'default')!.binds);
    expect(ov()).toEqual({});
  });
});

describe('keybinds import / export', () => {
  it('round-trips the current keymap', () => {
    const res = parseKeybinds(serializeKeybinds({ 'tool.brush': 'k' }));
    expect(res.ok).toBe(true);
    expect(res.binds!['tool.brush']).toBe('k');
    // surface.mountain has no game default (null) and no override here, so it round-trips unbound.
    expect(res.binds!['surface.mountain']).toBe(null);
  });

  it('accepts a bare id->combo map and ignores unknown ids', () => {
    const res = parseKeybinds(JSON.stringify({ 'tool.brush': 'k', 'not.a.command': 'z' }));
    expect(res.ok).toBe(true);
    expect(res.binds!['tool.brush']).toBe('k');
    expect('not.a.command' in res.binds!).toBe(false);
  });

  it('rejects invalid JSON, duplicate combos, and a UI-scale twin', () => {
    expect(parseKeybinds('{nope').error).toBe('invalid-json');
    expect(parseKeybinds(JSON.stringify({ 'tool.brush': 'k', 'tool.eraser': 'k' })).error).toBe('duplicate-combo');
    // Ctrl+Shift+= is the shifted keycap of the file's own zoom-in binding (its default here).
    expect(parseKeybinds(JSON.stringify({ 'tool.brush': 'ctrl+shift+=' })).error).toBe('reserved-combo');
  });

  it('judges the twins against the zoom keys the file itself carries', () => {
    // Moving zoom-in off `=` frees its twin, and the file is read as one keymap.
    const res = parseKeybinds(JSON.stringify({ 'app.ui_zoom_in': 'ctrl+9', 'tool.brush': 'ctrl+shift+=' }));
    expect(res.ok).toBe(true);
    expect(res.binds!['tool.brush']).toBe('ctrl+shift+=');
  });

  it('imports history and UI-scale bindings like any other command', () => {
    const res = parseKeybinds(JSON.stringify({ 'history.undo': 'ctrl+alt+u', 'app.ui_zoom_in': 'ctrl+9' }));
    expect(res.ok).toBe(true);
    expect(res.binds!['history.undo']).toBe('ctrl+alt+u');
    expect(res.binds!['app.ui_zoom_in']).toBe('ctrl+9');
  });
});
