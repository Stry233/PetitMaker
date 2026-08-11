/**
 * The keymap is data and the command behaviour is code. The pointer machine reads the held-key
 * combos, so the data has to sit below `canvas`; only the `run` half needs the layers above it.
 */
import { describe, it, expect } from 'vitest';
import { COMMAND_META, META_BY_ID, effectiveCombo, normalizeCombo, bindingIndex } from '../../core/runtime/keybindings';

describe('keymap data', () => {
  it('indexes every declared command by id', () => {
    expect(META_BY_ID.size).toBe(COMMAND_META.length);
    for (const meta of COMMAND_META) expect(META_BY_ID.get(meta.id)).toBe(meta);
  });

  it('normalizes modifier order and case', () => {
    expect(normalizeCombo('Shift+G')).toBe('shift+g');
    expect(normalizeCombo('G+Shift')).toBe('shift+g');
  });

  it('lets an override replace a default binding', () => {
    const rebindable = COMMAND_META.find((c) => !c.reserved && c.defaultCombo)!;
    expect(effectiveCombo({ [rebindable.id]: 'ctrl+alt+j' }, rebindable.id)).toBe('ctrl+alt+j');
  });

  it('ignores overrides on a reserved command', () => {
    const reserved = COMMAND_META.find((c) => c.reserved)!;
    expect(effectiveCombo({ [reserved.id]: 'ctrl+alt+j' }, reserved.id)).toBe(reserved.defaultCombo);
  });

  it('maps each bound combo to exactly one command', () => {
    const index = bindingIndex({});
    expect(index.size).toBe(new Set(index.values()).size === index.size ? index.size : -1);
  });
});
