/**
 * The hand phone tile ('move' action) collapses any open spoke back to the
 * hub and activates the Hand tool; other Hand entry points (in-submenu) are
 * unaffected, so this only covers the tile dispatch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMenuNavigation } from '../../ui/hooks/useMenuNavigation';
import { GRID_TILES, BUILD_TILES } from '../../ui/menu/metrics';
import { useEditorStore } from '../../state/store';
import { ToolType } from '../../core/model/types';

const params = () => ({
  setSelectingRegion: vi.fn(),
  setGenRegion: vi.fn(),
  setShowNewProject: vi.fn(),
  handleImage: vi.fn(),
  handleExport: vi.fn(),
  handleImport: vi.fn(),
});
const moveTile = GRID_TILES.find((t) => t.action === 'move')!;
const generateTile = GRID_TILES.find((t) => t.action === 'generate')!;

describe('useMenuNavigation — hand tile collapses an open spoke', () => {
  beforeEach(() => { useEditorStore.setState({ activeTool: ToolType.TerrainBrush }); });

  it('tapping the hand tile while a spoke is open returns to home + activates Hand', () => {
    const { result } = renderHook(() => useMenuNavigation(params()));
    const placementTile = GRID_TILES.find((t) => t.action === 'placement')!;
    act(() => result.current.handleTileAction(placementTile)); // open a spoke
    expect(result.current.menuView).toBe('placement');
    act(() => result.current.handleTileAction(moveTile));      // tap Hand
    expect(result.current.menuView).toBe('home');              // spoke collapsed
    expect(result.current.activeSpoke).toBeNull();
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });

  it('keeps Generate open, because panning to look at what it produced is part of using it', () => {
    // Generate is a workbench, not a picker: its sliders and any painted region are work in
    // progress, so the hand tile pans WITHOUT collapsing it. Every other spoke still collapses.
    const { result } = renderHook(() => useMenuNavigation(params()));
    act(() => result.current.handleTileAction(generateTile));
    expect(result.current.menuView).toBe('generate');
    act(() => result.current.handleTileAction(moveTile));
    expect(result.current.menuView).toBe('generate');          // still open
    expect(result.current.activeSpoke?.id).toBe(generateTile.id);
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand); // and panning is armed
  });

  it('tapping the hand tile from the hub just (re)activates Hand, staying home', () => {
    const { result } = renderHook(() => useMenuNavigation(params()));
    expect(result.current.menuView).toBe('home');
    act(() => result.current.handleTileAction(moveTile));
    expect(result.current.menuView).toBe('home');
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });

  it('the in-submenu hand mode is untouched: opening Build stays on the build spoke', () => {
    const { result } = renderHook(() => useMenuNavigation(params()));
    const buildTile = BUILD_TILES.find((t) => t.action === 'build')!;
    act(() => result.current.handleTileAction(buildTile));
    expect(result.current.menuView).toBe('build'); // spoke stays open; move tile is the only collapser
  });
});
