import { afterEach, describe, expect, it } from 'vitest';
import { bindingIndex, detectPreset, effectiveCombo } from '../../../state/keymap/resolve';
import { parseKeybinds, serializeKeybinds } from '../../../state/keymap/file';
import { useKeybinds } from '../../../state/keymap/store';
import { CONTEXT_FREE_TOOLBAR, CONTEXT_KEYS, TOOLBAR_CONTEXTS, toolbarDefault, keyContext, toolbarContextOf, toolbarLabel, type KeyContextInputs } from '../../../state/keymap/toolbar';
import { COMMAND_META, META_BY_ID } from '../../../state/keymap/registry';
import { translations } from '../../../i18n/translations';

afterEach(() => useKeybinds.getState().resetAll());

describe('contextual toolbar bindings', () => {
  it.each(TOOLBAR_CONTEXTS)('numbers visible groups without gaps in %s', context => {
    const bindings = new Map(COMMAND_META.flatMap((c) => {
      const combo = toolbarDefault(context, c.id);
      return typeof combo === 'string' ? [[c.id, combo] as const] : [];
    }));
    const numbers = [...bindings.values()].filter(combo => combo !== 'q').sort((a, b) => Number(a) - Number(b));
    expect(numbers).toEqual(numbers.map((_, index) => String(index + 1)));
    expect(numbers.length).toBeLessThanOrEqual(9);
    for (const [id, combo] of bindings) expect(bindingIndex({}, context).get(combo)).toBe(id);
  });

  it('gives a toolbar command its keys from the toolbar table alone', () => {
    const toolbarCommands = COMMAND_META.filter((c) => TOOLBAR_CONTEXTS.some((context) => toolbarDefault(context, c.id) !== undefined));
    expect(toolbarCommands.length).toBeGreaterThan(0);
    for (const cmd of toolbarCommands) {
      expect(cmd.defaultCombo, `${cmd.id} carries no registry combo`).toBeNull();
      expect(toolbarDefault(CONTEXT_FREE_TOOLBAR, cmd.id), `${cmd.id} has a context-free key`).not.toBeNull();
      expect(effectiveCombo({}, cmd.id)).toBe(toolbarDefault(CONTEXT_FREE_TOOLBAR, cmd.id));
      for (const context of TOOLBAR_CONTEXTS) expect(effectiveCombo({}, cmd.id, context)).toBe(toolbarDefault(context, cmd.id));
    }
    expect(effectiveCombo({}, 'tool.shape_cycle'), 'a reader naming no toolbar').toBe(effectiveCombo({}, 'tool.shape_cycle', CONTEXT_FREE_TOOLBAR));
  });

  it('uses the terrain fifth slot for shapes and the annotation fifth slot for measuring', () => {
    expect(bindingIndex({}, 'terrain').get('5')).toBe('tool.shape_cycle');
    expect(bindingIndex({}, 'terrain').has('6')).toBe(false);
    expect(bindingIndex({}, 'notes-zone').get('5')).toBe('tool.measure');
    expect(bindingIndex({}, 'notes-zone').get('6')).toBe('tool.shape_cycle');
    expect(toolbarLabel('notes-chip', 'tool.option_cycle')).toBe('annot.size');
    expect(toolbarLabel('notes-route', 'tool.option_cycle')).toBe('annot.line_style');
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

describe('the key context', () => {
  const at = (over: Partial<KeyContextInputs>): KeyContextInputs => ({ selectingRegion: false, editMode: { mode: null }, annotationTool: 'none', ...over });

  it('puts the region brush first, then the notes by their tool, then a terrain surface, then the map', () => {
    expect(keyContext(at({ selectingRegion: true, editMode: { mode: 'annotate' } }))).toBe('region');
    expect(keyContext(at({ editMode: { mode: 'annotate' }, annotationTool: 'route' }))).toBe('notes-route');
    expect(keyContext(at({ editMode: { mode: 'annotate' }, annotationTool: 'measure' }))).toBe('notes-other');
    expect(keyContext(at({ editMode: { mode: 'road' } }))).toBe('terrain');
    expect(keyContext(at({ editMode: { mode: 'object' } }))).toBe('map');
    expect(toolbarContextOf(at({ editMode: { mode: 'object' } }))).toBe('terrain');
  });

  it('labels a key from the same row that names its action, with a label every locale carries', () => {
    for (const context of TOOLBAR_CONTEXTS) {
      for (const [id, key] of Object.entries(CONTEXT_KEYS[context])) {
        expect(META_BY_ID.has(id), id).toBe(true);
        expect(toolbarLabel(context, id)).toBe(key!.label);
        if (key!.label) expect(translations.en[key!.label], key!.label).toBeTruthy();
      }
    }
    expect(toolbarLabel('region', 'tool.option_cycle')).toBe('region.dimensions');
    expect(toolbarLabel('terrain', 'tool.option_cycle')).toBeUndefined();
  });
});
