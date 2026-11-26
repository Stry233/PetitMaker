/** A keymap saved before a command existed: the new command takes its shortcut style's key where the
 *  saved keymap leaves that key free, so the keymap keeps its style's name. */
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { removePref, writePref } from '../../../platform/storage/prefs';

/** The store and resolution as a page that opens with `saved` stored as its keymap reads them. */
async function openWith(saved: Record<string, string | null>) {
  writePref('keybinds', JSON.stringify(saved));
  vi.resetModules();
  const { useKeybinds } = await import('../../../state/keymap/store');
  const { detectPreset, effectiveCombo, overridesFor } = await import('../../../state/keymap/resolve');
  return { overrides: useKeybinds.getState().overrides, detectPreset, effectiveCombo, overridesFor };
}

/** The Pro style as a release before Flip stored it: every Pro binding but Flip's. */
async function olderPro(): Promise<Record<string, string | null>> {
  vi.resetModules();
  const { PRESETS } = await import('../../../state/keymap/registry');
  const { overridesFor } = await import('../../../state/keymap/resolve');
  const { 'selection.flip': _flip, ...older } = overridesFor(PRESETS.find((p) => p.id === 'pro')!.binds);
  return older;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { removePref('keybinds'); vi.resetModules(); });

spec('UI-15', 'a Pro keymap saved before Flip gives Flip Pro\'s slash and still reads as Pro', async () => {
  const saved = await olderPro();
  expect(saved).not.toHaveProperty('selection.flip');
  const { overrides, detectPreset, effectiveCombo } = await openWith(saved);
  expect(effectiveCombo(overrides, 'selection.flip')).toBe('/');
  expect(effectiveCombo(overrides, 'tool.line')).toBe('f');
  expect(detectPreset(overrides)).toBe('pro');
});

spec('UI-15', 'a keymap saved before Flip that already uses the slash leaves Flip unbound and reads as custom', async () => {
  const saved = { ...await olderPro(), 'app.menu': '/' };
  const { overrides, detectPreset, effectiveCombo } = await openWith(saved);
  expect(effectiveCombo(overrides, 'selection.flip')).toBeNull();
  expect(effectiveCombo(overrides, 'app.menu')).toBe('/');
  expect(detectPreset(overrides)).toBe('custom');
});

spec('UI-15', 'a keymap saved once Flip existed keeps what it says of Flip', async () => {
  const saved = await olderPro();
  // Opened once, the keymap is written again knowing every command, so a Flip unbound by hand stays so.
  const first = await openWith(saved);
  expect(first.effectiveCombo(first.overrides, 'selection.flip')).toBe('/');
  const { useKeybinds } = await import('../../../state/keymap/store');
  useKeybinds.getState().clear('selection.flip');
  vi.resetModules();
  const { useKeybinds: reopened } = await import('../../../state/keymap/store');
  const { effectiveCombo } = await import('../../../state/keymap/resolve');
  expect(effectiveCombo(reopened.getState().overrides, 'selection.flip')).toBeNull();
});
