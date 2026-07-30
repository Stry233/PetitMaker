/**
 * Keymap presets ("shortcut styles") + JSON import/export. A preset must be internally valid (unique
 * combo per command) or applying it would leave a broken keymap; import must reject conflicts so a
 * crafted/edited file can't collide two commands onto one key. Pure logic, unit-tested directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PRESETS, presetBinds, detectPreset, serializeKeybinds, parseKeybinds } from '../../ui/keybindings/presets';
import { useKeybinds, effectiveCombo } from '../../ui/keybindings/store';
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
});

describe('preset apply + detect', () => {
  beforeEach(() => useKeybinds.getState().resetAll());
  const ov = (): Record<string, string | null> => useKeybinds.getState().overrides;

  it('detects default with no overrides', () => {
    expect(detectPreset({})).toBe('default');
  });

  it('applyBinds(preset) makes detectPreset return that preset', () => {
    useKeybinds.getState().applyBinds(PRESETS.find((p) => p.id === 'numeric')!.binds);
    expect(detectPreset(ov())).toBe('numeric');
    expect(effectiveCombo(ov(), 'tool.brush')).toBe('2');
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
    expect(res.binds!['surface.mountain']).toBe('1');
  });

  it('accepts a bare id->combo map and ignores unknown ids', () => {
    const res = parseKeybinds(JSON.stringify({ 'tool.brush': 'k', 'not.a.command': 'z' }));
    expect(res.ok).toBe(true);
    expect(res.binds!['tool.brush']).toBe('k');
    expect('not.a.command' in res.binds!).toBe(false);
  });

  it('rejects invalid JSON, duplicate combos, and reserved combos', () => {
    expect(parseKeybinds('{nope').error).toBe('invalid-json');
    expect(parseKeybinds(JSON.stringify({ 'tool.brush': 'k', 'tool.eraser': 'k' })).error).toBe('duplicate-combo');
    expect(parseKeybinds(JSON.stringify({ 'tool.brush': 'ctrl+z' })).error).toBe('reserved-combo');
  });

  it('never imports onto a reserved command', () => {
    const res = parseKeybinds(JSON.stringify({ 'history.undo': 'j', 'tool.brush': 'k' }));
    expect(res.ok).toBe(true);
    expect('history.undo' in res.binds!).toBe(false);
  });
});
