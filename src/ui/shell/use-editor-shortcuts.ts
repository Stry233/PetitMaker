/*
 * use-editor-shortcuts — the ONE keyboard-shortcut surface for the editor. It builds the runtime
 * bindings from the command REGISTRY (kit/commands, run bodies over core/runtime/keybindings' data)
 * applied over the user OVERRIDE store, and rebuilds whenever a rebinding changes. No keymap is
 * hardcoded here: adding or binding an operation happens in the registry.
 *
 * Continuous camera keys (WASD/arrow pan, Ctrl± UI scale) stay in canvas/interaction/use-view-
 * shortcuts (held-key rAF loops, a different concern); their key sets are disjoint from the registry.
 */
import { useEffect } from 'react';
import { ShortcutManager } from '../../core/runtime/shortcut-manager';
import { COMMANDS, COMMAND_BY_ID, type CommandContext } from '../../kit/commands';
import { effectiveCombo, useKeybinds, ALIASES } from '../../core/runtime/keybindings';
import { setBreakHandleKey, setConstrainKey, setMultiSelectKey, setPanDragKey } from '../../core/runtime/modifier-state';

/** The React-provided deps the command handlers need (everything else is read from the store). */
type Deps = CommandContext;

export function useEditorShortcuts({ openBuild, handleTileAction, regionUndo, regionRedo, toggleMenu }: Deps): void {
  useEffect(() => {
    const ctx: CommandContext = { openBuild, handleTileAction, regionUndo, regionRedo, toggleMenu };
    const build = (): ShortcutManager => {
      const sc = new ShortcutManager();
      const overrides = useKeybinds.getState().overrides;
      for (const cmd of COMMANDS) {
        if (cmd.continuous) continue; // held-key pan — driven by use-view-shortcuts, not the one-shot engine
        const combo = effectiveCombo(overrides, cmd.id);
        if (combo) sc.register(combo, () => cmd.run(ctx));
      }
      for (const alias of ALIASES) {
        const cmd = COMMAND_BY_ID.get(alias.commandId);
        if (cmd && !cmd.continuous) sc.register(alias.combo, () => cmd.run(ctx)); // continuous = held (pan), driven by use-view-shortcuts
      }
      // Keep the held modifiers (read by modifier-state) in sync with their rebindable bindings —
      // '' when the user unbinds one (disabled).
      const heldKey = (id: string) => {
        const combo = effectiveCombo(overrides, id);
        return combo ? combo.split('+').pop()! : '';
      };
      setConstrainKey(heldKey('tool.constrain'));
      setMultiSelectKey(heldKey('selection.multi'));
      setBreakHandleKey(heldKey('tool.break_handle'));
      setPanDragKey(heldKey('camera.pan_drag'));
      return sc;
    };
    let sc = build();
    const onKey = (e: KeyboardEvent): void => sc.handleKeyDown(e);
    window.addEventListener('keydown', onKey);
    // Rebuild the binding table whenever the user rebinds / clears / resets a shortcut.
    const unsub = useKeybinds.subscribe(() => { sc = build(); });
    return () => { window.removeEventListener('keydown', onKey); unsub(); };
  }, [openBuild, handleTileAction, regionUndo, regionRedo, toggleMenu]);
}
