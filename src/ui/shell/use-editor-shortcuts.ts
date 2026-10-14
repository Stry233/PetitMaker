/*
 * The editor's one keyboard surface: bindings built from the command registry (`editor/commands/commands`) over the
 * user's overrides, rebuilt on a rebind. The held pan keys and the UI-scale keys run in
 * `view/interaction/use-view-shortcuts` and are skipped here, so each key fires once.
 */
import { useEffect, useRef } from 'react';
import { ShortcutManager } from '../../platform/input/shortcut-manager';
import { keyBindings, type CommandContext } from '../../editor/commands/commands';
import { useKeybinds } from '../../state/keymap/store';
import { useToolbarContext } from '../session/use-toolbar-context';

/** The keyboard surface for the shell's command context (`editor/commands/commands.ts:keyBindings`). */
export function useEditorShortcuts({ toggleMenu }: CommandContext): void {
  const toolbar = useToolbarContext();
  const overrides = useKeybinds((s) => s.overrides);
  const table = useRef<ShortcutManager | null>(null);
  // Rebuild the binding table whenever the user rebinds / clears / resets a shortcut; the listener
  // stays put, so its order among the page's key listeners never changes on a rebind.
  useEffect(() => {
    const sc = new ShortcutManager();
    for (const binding of keyBindings(overrides, toolbar, { toggleMenu })) sc.register(binding.combo, binding.run);
    table.current = sc;
  }, [overrides, toggleMenu, toolbar]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => table.current?.handleKeyDown(e);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [toggleMenu, toolbar]);
}
