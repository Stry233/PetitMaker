/*
 * use-shell-commands.ts — what a keyboard command MEANS in this shell.
 *
 * `use-editor-shortcuts` is the one keyboard surface for the editor: it builds every binding
 * from the command registry over the user's overrides, and it also publishes the HELD modifiers
 * (constrain, multi-select, break-handle, pan-drag) that the pointer machine reads. Four of its
 * callbacks cannot be answered from the store alone, because what they mean depends on how the
 * chrome is arranged; they are answered here, in this frame's own terms.
 *
 * Everything else a command does it does through the store, the kit host or the active view, so the
 * whole rest of the registry is chrome-independent and arrives working.
 */
import { IS_LITE } from '../../core/runtime/edition';
import { useCallback } from 'react';
import { MODE_FOR_CONTENT, designModeToEditInputs } from '../../core/model/edit-mode';
import type { DesignMode } from '../../core/model/types';
import type { EditorAction } from '../../kit/actions';
import type { CommandContext } from '../../kit/commands';
import { useEditorStore } from '../../state/store';
import { REGION_TOOL_FOR } from './bars/scope-cells';
import { terrainSurface } from './bars/terrain-cells';

export interface ShellCommandDeps {
  /** The menu sheet's own toggle. It lives in the shell's React state, not the store. */
  toggleMenu: () => void;
  regionUndo: () => boolean;
  regionRedo: () => boolean;
}

/**
 * The four callbacks, as this frame answers them.
 *
 * They are `useCallback`s over the store's own setters and the two the shell passes in, because the
 * hook rebuilds its whole binding table whenever one of them changes identity.
 */
export function useShellCommands({ toggleMenu, regionUndo, regionRedo }: ShellCommandDeps): CommandContext {
  const setEditMode = useEditorStore((s) => s.setEditMode);
  const setModal = useEditorStore((s) => s.setModal);
  const setSelectingRegion = useEditorStore((s) => s.setSelectingRegion);

  /**
   * A tool key: the same thing pressing that cell of the terrain bar does.
   *
   * `designModeToEditInputs` is the registry's `DesignMode` turned into the two inputs a shell
   * offers, and it deliberately does not name a surface — a tool is chosen INSIDE one. So the
   * surface is whichever terrain mode is already in force, and where none is (rest, or the object
   * and generate shelves, neither of which has tools) the key opens one: the store's own
   * `contentType`, which rest reports as mountain — taken from the resolver rather than from a
   * second memory of its own.
   *
   * Every `DesignMode` the registry sends has a cell in that row. The one that does not, 'hand', is
   * the resting state rather than a tool and is bound to no key.
   */
  const openBuild = useCallback((design: DesignMode) => {
    const s = useEditorStore.getState();
    // The scope screen wears the terrain bar's row, keys included, so while it is up a tool key
    // picks the REGION's figure. It is the same six drawings and the same six letters; what differs
    // is what the stroke collects.
    if (s.selectingRegion) {
      const region = REGION_TOOL_FOR[design];
      if (region) s.setRegionTool(region);
      return;
    }
    // The plan-notes bar has its own cells and no bindings yet: a terrain tool key pressed there
    // must not yank the user onto a terrain surface mid-annotation.
    if (s.editMode.mode === 'annotate') return;
    const surface = terrainSurface(s.editMode.mode) ?? MODE_FOR_CONTENT[s.contentType];
    setEditMode({ mode: surface, ...designModeToEditInputs(design) });
  }, [setEditMode]);

  /**
   * A tile action, which in this shell is mostly a mode or a window.
   *
   * The one thing a key cannot carry is a placement CATEGORY: the object shelf holds its category
   * in its own state and opens on whatever item is armed, so there is nothing to hand it. The key
   * therefore opens the shelf and leaves the category where the visitor left it, which is the
   * shelf's own rule for every other way in.
   */
  const handleTileAction = useCallback((action: EditorAction) => {
    if (action.action === 'file') {
      if (action.payload === 'new') setModal('newProject', true);
      // The save-and-share window carries both exports as sections, and opens at the one named.
      else if (action.payload === 'image') setModal('export', true);
      else if (!IS_LITE && action.payload === 'export') setModal('exportJson', true);
      else if (!IS_LITE && action.payload === 'import') setModal('import', true);
      return;
    }
    if (action.action === 'move') {
      // Rest: nothing armed, no bar, and the region brush put away with it — both arm the pointer
      // and a region left on would hand every press to the brush that paints a scope.
      setSelectingRegion(false);
      setEditMode({ mode: null });
      return;
    }
    if (action.action === 'build') {
      setEditMode({ mode: MODE_FOR_CONTENT[action.payload as 'mountain' | 'water' | 'tile'], tool: 'brush' });
      return;
    }
    if (action.action === 'placement') {
      setEditMode({ mode: 'object', itemId: null });
      return;
    }
    setEditMode({ mode: 'generate' });
  }, [setEditMode, setModal, setSelectingRegion]);

  return { openBuild, handleTileAction, toggleMenu, regionUndo, regionRedo };
}
