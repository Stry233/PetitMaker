/*
 * useMenuNavigation.ts — the hub → spoke menu navigation state machine extracted
 * from App.tsx. Owns the view state (menuView / activeSpoke / placementCategory,
 * plus `menuCollapsed`, which lives in the store) and the three navigation actions:
 *   - navigate(view): switches the view and applies the per-view side-effects
 *     (clear selection/menus, exit region-select, set the matching tool).
 *   - openBuild(mode): opens the build subpanel for the current content in a draw
 *     mode. Called both by a build-tile tap and by the keyboard shortcuts
 *     (ui/hooks/useEditorShortcuts) so a mode key mirrors clicking the tile.
 *   - handleTileAction(spec): dispatches a home-screen tile tap to its action
 *     (also reused by the keyboard shortcuts for surfaces / generate / new / move).
 *
 * The file-IO handlers and the shared genRegion / selectingRegion setters live
 * outside this concern, so App threads them in. The store setters this state
 * machine mutates (setActiveTool / setDesignMode / setContentType) are read from
 * the store here, exactly as App did — so every useCallback dependency array is
 * preserved verbatim. Behaviour is unchanged.
 */
import { useCallback, useState } from 'react';
import { petitWindow } from '../../core/runtime/window-bridge';
import { useEditorStore } from '../../state/store';
import { ToolType } from '../../core/model/types';
import type { MacroCoord, ItemCategory, DesignMode } from '../../core/model/types';
import { designModeToToolType } from '../menu/design-mode';
import { BUILD_TILES, GRID_TILES, type TileSpec } from '../menu/metrics';

type MenuView = 'home' | 'build' | 'placement' | 'generate';

export interface MenuNavigationParams {
  setSelectingRegion: (v: boolean) => void;
  setGenRegion: (cells: MacroCoord[]) => void;
  handleImage: () => void;
  handleExport: () => void;
  handleImport: () => void;
}

export interface MenuNavigation {
  menuView: MenuView;
  setMenuView: (v: MenuView) => void;
  menuCollapsed: boolean;
  setMenuCollapsed: (v: boolean) => void;
  activeSpoke: TileSpec | null;
  setActiveSpoke: (s: TileSpec | null) => void;
  placementCategory: ItemCategory | undefined;
  setPlacementCategory: (c: ItemCategory | undefined) => void;
  navigate: (view: MenuView) => void;
  openBuild: (mode: DesignMode) => void;
  handleTileAction: (spec: TileSpec) => void;
}

export function useMenuNavigation({
  setSelectingRegion,
  setGenRegion,
  handleImage,
  handleExport,
  handleImport,
}: MenuNavigationParams): MenuNavigation {
  const [menuView, setMenuView] = useState<MenuView>('home');
  // Collapsed/expanded is store state, not local: the tour reads it to notice that the visitor
  // opened or put away the menu themselves (see `advanceWhen` in chrome/tour/steps).
  const menuCollapsed = useEditorStore((s) => s.menuCollapsed);
  const setMenuCollapsed = useEditorStore((s) => s.setMenuCollapsed);
  const [placementCategory, setPlacementCategory] = useState<ItemCategory | undefined>(undefined);
  const [activeSpoke, setActiveSpoke] = useState<TileSpec | null>(null);

  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const setContentType = useEditorStore((s) => s.setContentType);
  const setDesignMode = useEditorStore((s) => s.setDesignMode);

  // Switches the hub→spoke view and applies the per-view side-effects: clear
  // selection/menus, exit region-select, and set the active tool to match the
  // destination view.
  const navigate = useCallback((view: MenuView) => {
    const store = useEditorStore.getState();
    const prev = menuView;
    setMenuView(view);
    store.clearSelection();
    store.setContextMenu(null);
    store.setDeletePopover(null);

    if (view !== 'generate') {
      setSelectingRegion(false);
      setGenRegion([]);
      petitWindow().__petitClearPreview?.();
    }

    if (view === 'placement' || prev === 'placement') store.setSelectedItemId(null);
    if (view === 'placement') setActiveTool(ToolType.Hand);

    if (view === 'build') {
      // Read the freshest designMode from the store, not the render closure:
      // callers set the mode right before navigating (a build tile sets 'brush',
      // then navigates), and we must activate THAT tool — using the closure's
      // stale designMode left the cursor on pan while the panel showed brush.
      setActiveTool(designModeToToolType(store.designMode));
    } else if (view === 'home') {
      setActiveTool(ToolType.Hand);
    }
  }, [menuView, setSelectingRegion, setActiveTool]);

  // Open the build subpanel for the current content in a given draw mode — so a mode keyboard
  // shortcut mirrors clicking a build tile (panel opens + mode highlights), not just swapping the
  // cursor tool. Accepts any draw mode (brush/line/curve/rect/circle/eraser/edge-cut).
  const openBuild = useCallback((mode: DesignMode) => {
    const ct = useEditorStore.getState().contentType;
    const spec = [...BUILD_TILES, ...GRID_TILES].find((s) => s.action === 'build' && s.payload === ct);
    setMenuCollapsed(false);
    if (spec) setActiveSpoke(spec);
    setDesignMode(mode);   // set before navigate() so it activates the matching tool
    navigate('build');
  }, [navigate, setDesignMode]);

  // Dispatches a home-screen tile tap to its action.
  const handleTileAction = useCallback((spec: TileSpec) => {
    if (spec.action === 'file') {
      if (spec.payload === 'new') useEditorStore.getState().setModal('newProject', true);
      else if (spec.payload === 'image') handleImage();
      else if (spec.payload === 'export') handleExport();
      else if (spec.payload === 'import') handleImport();
      return;
    }
    if (spec.action === 'move') {
      // Pan/move — not a spoke. Activate the hand tool AND collapse any open
      // spoke back to the hub so the canvas is clear to pan; if none is open,
      // navigate('home') is a harmless no-op that just (re)sets the hand tool.
      setSelectingRegion(false);
      setDesignMode('hand');
      // GENERATE STAYS OPEN: its sliders and painted region are work in progress, and panning to
      // look at the result is part of using it. Sets the hand tool itself, since it returns
      // before the navigate('home') below that normally does so.
      if (menuView === 'generate') {
        setActiveTool(ToolType.Hand);
        return;
      }
      setActiveSpoke(null);
      navigate('home');
      return;
    }
    // Spoke tiles toggle: tapping the open spoke's tile again closes it
    // (the design has no close button — re-tap, or tap another tile).
    if (menuView === spec.action && activeSpoke?.id === spec.id) {
      setActiveSpoke(null);
      navigate('home');
      return;
    }
    setActiveSpoke(spec);
    if (spec.action === 'build') {
      setContentType(spec.payload as 'mountain' | 'water' | 'tile');
      setDesignMode('brush');
      navigate('build');
    } else if (spec.action === 'placement') {
      setPlacementCategory(spec.payload as ItemCategory);
      navigate('placement');
    } else {
      navigate('generate');
    }
  }, [menuView, activeSpoke, handleImage, handleExport, handleImport, setContentType, setDesignMode, setActiveTool, setSelectingRegion, navigate]);

  return {
    menuView,
    setMenuView,
    menuCollapsed,
    setMenuCollapsed,
    activeSpoke,
    setActiveSpoke,
    placementCategory,
    setPlacementCategory,
    navigate,
    openBuild,
    handleTileAction,
  };
}
