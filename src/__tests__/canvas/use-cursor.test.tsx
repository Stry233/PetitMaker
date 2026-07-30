import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { useRef } from 'react';
import { useCursor } from '../../canvas/interaction/use-cursor';
import { __resetCursorController } from '../../canvas/interaction/cursor-controller';
import { cursorCss } from '../../ui/cursors/cursor-css';
import { registerToolManager } from '../../canvas/active-view';
import { ToolType } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import { makeTestToolManager } from '../tools/_tool-manager';
import { setStoreState } from '../_store';

function Host({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useCursor(ref, active);
  return <div ref={ref} data-testid="surface" />;
}

// Mounts both views' hosts in the SAME tree, in App.tsx's tree order (the 2D-equivalent host
// first, the 3D-equivalent second), each with its own ref and its own active flag derived from
// the store the way PixiCanvas/Editor3DCanvas really do — so a regression in ownership (surface
// following mount/effect order instead of visibility) shows up here exactly as it would in the app.
function TwoHosts() {
  const viewMode = useEditorStore((s) => s.viewMode);
  const ref2d = useRef<HTMLDivElement>(null);
  const ref3d = useRef<HTMLDivElement>(null);
  useCursor(ref2d, viewMode !== '3d');
  useCursor(ref3d, viewMode === '3d');
  return (
    <>
      <div ref={ref2d} data-testid="surface-2d" />
      <div ref={ref3d} data-testid="surface-3d" />
    </>
  );
}

beforeEach(() => {
  __resetCursorController();
  const tm = makeTestToolManager();
  tm.setActiveTool(ToolType.Eraser);
  registerToolManager(tm);
  setStoreState({
    activeTool: ToolType.Eraser, selectingRegion: false, viewMode: '2d', contentType: 'mountain',
  });
});
afterEach(() => { cleanup(); registerToolManager(null); });

describe('useCursor', () => {
  it('writes the active tool\'s cursor to the container', () => {
    const { getByTestId } = render(<Host />);
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('eraser'));
  });

  it('follows a tool switch', () => {
    const { getByTestId } = render(<Host />);
    const tm = makeTestToolManager();
    tm.setActiveTool(ToolType.Hand);
    registerToolManager(tm);
    act(() => { setStoreState({ activeTool: ToolType.Hand }); });
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('hand-open'));
  });

  it('follows the build MATERIAL, which switches without ever touching activeTool', () => {
    // All five shape modes AND all three materials are the ONE ToolType.TerrainBrush, and the
    // brush's cursor is a getter over the store's contentType. Picking River from the Build
    // panel calls setContentType only, so a dep array missing contentType leaves the mountain
    // peak on screen while the brush paints water. Drives the real store transition.
    const tm = makeTestToolManager();
    const brush = tm.getToolById(ToolType.TerrainBrush) as DrawingTool;
    tm.setActiveTool(ToolType.TerrainBrush);
    registerToolManager(tm);
    act(() => {
      setStoreState({ activeTool: ToolType.TerrainBrush });
      useEditorStore.getState().setContentType('mountain');
      brush.contentType = 'mountain';
    });
    const { getByTestId } = render(<Host />);
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('mountain'));

    // activeTool is not touched: picking River from the Build panel is the whole gesture.
    act(() => {
      useEditorStore.getState().setContentType('water');
      brush.contentType = 'water'; // PixiCanvas's store -> tool sync effect
    });
    expect(useEditorStore.getState().activeTool).toBe(ToolType.TerrainBrush);
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('water'));

    act(() => {
      useEditorStore.getState().setContentType('tile');
      brush.contentType = 'tile';
    });
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('road'));
  });

  it('lets region-select mode outrank the tool', () => {
    const { getByTestId } = render(<Host />);
    act(() => { setStoreState({ selectingRegion: true }); });
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('marquee'));
  });

  it('clears the container on unmount, so a hidden canvas leaves no cursor behind', () => {
    const { getByTestId, unmount } = render(<Host />);
    const el = getByTestId('surface');
    unmount();
    expect(el.style.cursor).toBe('');
  });

  it('picks up the tool a frame later when no ToolManager is registered yet at mount', async () => {
    // PixiCanvas registers its ToolManager in an effect that runs AFTER usePointerInteraction
    // (and useCursor); on first mount there is nothing to read, so the surface shows the
    // controller's plain default until the retry lands. The hook must retry on the next
    // frame rather than silently leaving the container stuck there.
    registerToolManager(null);
    const { getByTestId } = render(<Host />);
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('select'));
    const tm = makeTestToolManager();
    tm.setActiveTool(ToolType.Eraser);
    registerToolManager(tm);
    await waitFor(() => expect(getByTestId('surface').style.cursor).toBe(cursorCss('eraser')));
  });

  it('gives the surface to the VISIBLE view, not whichever mounted or re-ran its effect last', () => {
    // Both canvases are permanently mounted in the real app; only `viewMode` says which one is
    // on screen. Regression guard for the surface-ownership bug: a blind `register(null)` on
    // deactivation would let the view being hidden wipe the claim the view being shown just made.
    const { getByTestId } = render(<TwoHosts />);
    expect(getByTestId('surface-2d').style.cursor).toBe(cursorCss('eraser'));
    expect(getByTestId('surface-3d').style.cursor).toBe('');

    act(() => { setStoreState({ viewMode: '3d' }); });
    expect(getByTestId('surface-3d').style.cursor).toBe(cursorCss('eraser'));
    expect(getByTestId('surface-2d').style.cursor).toBe('');

    // The leg that catches a blind register(null): flipping back must hand the surface back to
    // 2D, not leave both blank (or leave 3D holding a stale claim).
    act(() => { setStoreState({ viewMode: '2d' }); });
    expect(getByTestId('surface-2d').style.cursor).toBe(cursorCss('eraser'));
    expect(getByTestId('surface-3d').style.cursor).toBe('');
  });
});
