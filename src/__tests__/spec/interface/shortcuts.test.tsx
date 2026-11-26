// @vitest-environment jsdom
/** Keyboard shortcuts: every one rebinds, a taken key moves, and none reaches the map behind a window. */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { spec } from '../../_support/spec';
import { useKeybinds } from '../../../state/keymap/store';
import { COMMAND_META } from '../../../state/keymap/registry';
import { effectiveCombo } from '../../../state/keymap/resolve';
import { normalizeCombo } from '../../../platform/input/combo';
import { ShortcutManager } from '../../../platform/input/shortcut-manager';
import { ModalShell } from '../../../ui/primitives/ModalShell';

const bound = (id: string): string | null => effectiveCombo(useKeybinds.getState().overrides, id);

beforeEach(() => { useKeybinds.getState().resetAll(); });
afterEach(() => { useKeybinds.getState().resetAll(); cleanup(); });

describe('rebinding', () => {
  spec('UI-15', 'takes a new key for every shortcut, moving it from the command that held it, which is left unbound', () => {
    const combo = normalizeCombo('ctrl+alt+shift+k')!;
    let holder: string | null = null;
    for (const { id } of COMMAND_META) {
      const result = useKeybinds.getState().rebind(id, combo);
      expect(result.ok, id).toBe(true);
      expect(bound(id), id).toBe(combo);
      if (holder) {
        expect(result.displaced, id).toBe(holder);
        expect(bound(holder), holder).toBeNull();
      }
      holder = id;
    }
  });

  spec('UI-15', 'refuses a key the browser or the system takes, alone or under a modifier, and leaves the command on its key', () => {
    const id = COMMAND_META.find((c) => c.defaultCombo !== null)!.id;
    const before = bound(id);
    for (const combo of ['enter', 'tab', 'f5', 'f12', 'capslock', 'ctrl+enter', 'shift+f5']) {
      const result = useKeybinds.getState().rebind(id, combo);
      expect(result, combo).toEqual({ ok: false, reason: 'unbindable-key' });
      expect(bound(id), combo).toBe(before);
    }
    // The keypad's Enter is its own key, which the page hears.
    expect(useKeybinds.getState().rebind(id, 'numenter').ok).toBe(true);
  });
});

describe('a window in front of the map', () => {
  spec('UI-16', 'keeps the map shortcuts from acting while it is open', () => {
    let pressed = 0;
    const keys = new ShortcutManager();
    keys.register('b', () => { pressed++; });
    const onKey = (e: KeyboardEvent): void => keys.handleKeyDown(e);
    window.addEventListener('keydown', onKey);
    try {
      const view = render(<ModalShell open onClose={() => {}} width={300}><button type="button">Inside</button></ModalShell>);
      fireEvent.keyDown(window, { key: 'b' });
      expect(pressed, 'with the window open').toBe(0);
      view.rerender(<ModalShell open={false} onClose={() => {}} width={300}><button type="button">Inside</button></ModalShell>);
      fireEvent.keyDown(window, { key: 'b' });
      expect(pressed, 'once it has closed').toBe(1);
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });
});
