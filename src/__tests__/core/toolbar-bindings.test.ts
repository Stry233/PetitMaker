import { afterEach, describe, expect, it } from 'vitest';
import { bindingIndex, detectPreset, effectiveCombo, parseKeybinds, serializeKeybinds, useKeybinds } from '../../core/runtime/keybindings';
import { TOOLBAR_CONTEXTS, toolbarBindings, toolbarLabel } from '../../core/runtime/toolbar-bindings';

afterEach(() => useKeybinds.getState().resetAll());

describe('contextual toolbar bindings', () => {
  it.each(TOOLBAR_CONTEXTS)('numbers visible groups without gaps in %s', context => {
    const bindings = toolbarBindings(context);
    const numbers = [...bindings.values()].filter(combo => combo !== 'q');
    expect(numbers).toEqual(numbers.map((_, index) => String(index + 1)));
    expect(numbers.length).toBeLessThanOrEqual(9);
    for (const [id, combo] of bindings) expect(bindingIndex({}, context).get(combo)).toBe(id);
  });

  it('uses the terrain fifth slot for shapes and the annotation fifth slot for measuring', () => {
    expect(bindingIndex({}, 'terrain').get('5')).toBe('tool.shape_cycle');
    expect(bindingIndex({}, 'terrain').has('6')).toBe(false);
    expect(bindingIndex({}, 'notes-zone').get('5')).toBe('tool.measure');
    expect(bindingIndex({}, 'notes-zone').get('6')).toBe('tool.shape_cycle');
    expect(toolbarLabel('notes-chip', 'tool.auto_trim')).toBe('annot.size');
    expect(toolbarLabel('notes-route', 'tool.auto_trim')).toBe('annot.line_style');
    expect(bindingIndex({}, 'notes-other').has('q')).toBe(false);
  });

  it('keeps a custom key across contexts and restores adaptive defaults when reset', () => {
    useKeybinds.getState().rebind('tool.shape_cycle', '8', 'terrain');
    for (const context of ['terrain', 'notes-zone'] as const) {
      expect(effectiveCombo(useKeybinds.getState().overrides, 'tool.shape_cycle', context)).toBe('8');
    }
    useKeybinds.getState().rebind('tool.shape_cycle', '5', 'terrain');
    expect(effectiveCombo(useKeybinds.getState().overrides, 'tool.shape_cycle', 'notes-zone')).toBe('6');
    expect(effectiveCombo(useKeybinds.getState().overrides, 'tool.measure', 'notes-zone')).toBe('5');
  });

  it('preserves an explicit terrain 6 binding through keymap export and import', () => {
    useKeybinds.getState().rebind('tool.shape_cycle', '6', 'terrain');
    expect(detectPreset(useKeybinds.getState().overrides)).toBe('custom');
    const parsed = parseKeybinds(serializeKeybinds(useKeybinds.getState().overrides));
    expect(parsed.ok).toBe(true);
    useKeybinds.getState().resetAll();
    useKeybinds.getState().applyBinds(parsed.binds!, parsed.overrides);
    expect(effectiveCombo(useKeybinds.getState().overrides, 'tool.shape_cycle', 'terrain')).toBe('6');
  });

  it('resolves a conflict with a command available in another toolbar', () => {
    useKeybinds.getState().rebind('tool.measure', '8', 'notes-zone');
    useKeybinds.getState().rebind('tool.shape_cycle', '8', 'terrain');
    const overrides = useKeybinds.getState().overrides;
    expect(effectiveCombo(overrides, 'tool.measure', 'notes-zone')).toBeNull();
    expect(bindingIndex(overrides, 'notes-zone').get('8')).toBe('tool.shape_cycle');
    expect(parseKeybinds(serializeKeybinds(overrides)).ok).toBe(true);
  });
});
