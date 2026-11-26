/** Whether What's this and the interface scale keys hear a press made in a text field (EDIT-40). */
import { describe, expect, it } from 'vitest';
import { appKeyReaches } from '../../../state/keymap/toolbar';

const FIELD = { tagName: 'INPUT' } as unknown as EventTarget;
const press = (key: string, mods: { ctrl?: boolean; meta?: boolean; altGraph?: boolean } = {}, target: EventTarget | null = FIELD) => ({
  key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, target, getModifierState: (k: string) => k === 'AltGraph' && !!mods.altGraph,
});

describe('an app-wide key in a text field', () => {
  it('is heard anywhere outside a field', () => {
    expect(appKeyReaches(press('j', {}, null))).toBe(true);
  });

  it('stays the field\'s while it may type', () => {
    expect(appKeyReaches(press('j'))).toBe(false);
    expect(appKeyReaches(press('=', { ctrl: true, altGraph: true })), 'AltGraph types a character').toBe(false);
  });

  it('is heard from a field when it types nothing: an F key or a Ctrl or Cmd chord', () => {
    expect(appKeyReaches(press('F1'))).toBe(true);
    expect(appKeyReaches(press('=', { ctrl: true }))).toBe(true);
    expect(appKeyReaches(press('-', { meta: true }))).toBe(true);
  });
});
