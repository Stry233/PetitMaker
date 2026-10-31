// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { useRef } from 'react';
import { useCursor } from '../../../view/interaction/use-cursor';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { cursorCss } from '../../../assets/cursors/cursor-css';
import { registerToolManager } from '../../../view/active-view';
import { ToolType } from '../../../state/editing/vocabulary';
import { useKeybinds } from '../../../state/keymap/store';
import { useEditorStore } from '../../../state/store';
import { makeTestToolManager } from '../../_support/tool-manager';
import { setStoreState, armedEditMode } from '../../_support/store';
import { activeToolOf } from '../../../state/editing/edit-mode';

function Host({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useCursor(ref, active);
  return <div ref={ref} data-testid="surface" />;
}

// Mounts both view hosts in App.tsx order, with independent refs and store-derived active flags.
// Cursor ownership must follow visibility, not mount or effect order.
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
  window.dispatchEvent(new Event('blur'));
  useKeybinds.getState().resetAll();
  __resetCursorController();
  const tm = makeTestToolManager();
  tm.setActiveTool(ToolType.Eraser);
  registerToolManager(tm);
  setStoreState({ selectingRegion: false, viewMode: '2d', ...armedEditMode({ tool: ToolType.Eraser, content: 'mountain' }) });
});
afterEach(() => { cleanup(); registerToolManager(null); window.dispatchEvent(new Event('blur')); useKeybinds.getState().resetAll(); });

const panKey = (type: 'keydown' | 'keyup', key = ' ', code = 'Space') => {
  window.dispatchEvent(new KeyboardEvent(type, { key, code }));
};

describe('useCursor', () => {
  it('shows move on Space press and restores the tool on release without pointer movement', () => {
    const { getByTestId } = render(<Host />);
    const surface = getByTestId('surface');
    expect(surface.style.cursor).toBe(cursorCss('eraser'));
    panKey('keydown');
    expect(surface.style.cursor).toBe(cursorCss('move'));
    panKey('keyup');
    expect(surface.style.cursor).toBe(cursorCss('eraser'));
  });

  it('honors a rebound pan key and restores the cursor when that binding is disabled', () => {
    const { getByTestId } = render(<Host />);
    const surface = getByTestId('surface');
    useKeybinds.getState().rebind('camera.pan_drag', 'x');
    panKey('keydown');
    expect(surface.style.cursor).toBe(cursorCss('eraser'));
    panKey('keyup');
    panKey('keydown', 'x', 'KeyX');
    expect(surface.style.cursor).toBe(cursorCss('move'));
    useKeybinds.getState().clear('camera.pan_drag');
    expect(surface.style.cursor).toBe(cursorCss('eraser'));
  });

  it('carries held pan feedback between views and clears it on window blur', () => {
    const { getByTestId } = render(<TwoHosts />);
    panKey('keydown');
    expect(getByTestId('surface-2d').style.cursor).toBe(cursorCss('move'));
    act(() => { setStoreState({ viewMode: '3d' }); });
    expect(getByTestId('surface-2d').style.cursor).toBe('');
    expect(getByTestId('surface-3d').style.cursor).toBe(cursorCss('move'));
    window.dispatchEvent(new Event('blur'));
    expect(getByTestId('surface-3d').style.cursor).toBe(cursorCss('eraser'));
  });

  it('restores the newly selected tool when Space is released', () => {
    const { getByTestId } = render(<Host />);
    panKey('keydown');
    act(() => { setStoreState({ selectingRegion: true }); });
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('move'));
    panKey('keyup');
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('marquee'));
  });

  it('writes the active tool\'s cursor to the container', () => {
    const { getByTestId } = render(<Host />);
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('eraser'));
  });

  it('follows a tool switch', () => {
    const { getByTestId } = render(<Host />);
    const tm = makeTestToolManager();
    tm.setActiveTool(ToolType.Hand);
    registerToolManager(tm);
    act(() => { setStoreState({ ...armedEditMode({ tool: ToolType.Hand }) }); });
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('move'));
  });

  it('follows the annotation ARMING, which switches without ever touching activeTool', () => {
    // Every annotate arming is ToolType.Annotate, whose cursorFor reads ctx.annotationTool.
    const tm = makeTestToolManager();
    tm.setActiveTool(ToolType.Annotate);
    registerToolManager(tm);
    act(() => { setStoreState({ annotationTool: 'zone', ...armedEditMode({ tool: ToolType.Annotate }) }); });
    const { getByTestId } = render(<Host />);
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('place'));
    act(() => { setStoreState({ annotationTool: 'none' }); });
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('select'));
  });

  it('follows the build MATERIAL, which switches without ever touching activeTool', () => {
    // Every shape mode and material is ToolType.TerrainBrush, whose cursor reads the arming's
    // contentType; picking River from the Build panel changes only the surface.
    const tm = makeTestToolManager();
    tm.setActiveTool(ToolType.TerrainBrush);
    registerToolManager(tm);
    act(() => {
      setStoreState({ ...armedEditMode({ tool: ToolType.TerrainBrush }) });
      useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    });
    const { getByTestId } = render(<Host />);
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('mountain'));

    act(() => {
      useEditorStore.getState().setEditMode({ mode: 'water' });
    });
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.TerrainBrush);
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('water'));

    act(() => {
      useEditorStore.getState().setEditMode({ mode: 'road' });
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
    // PixiCanvas registers its ToolManager in an effect that runs after useCursor's, so the hook
    // shows the plain default on first mount and retries next frame.
    registerToolManager(null);
    const { getByTestId } = render(<Host />);
    expect(getByTestId('surface').style.cursor).toBe(cursorCss('select'));
    const tm = makeTestToolManager();
    tm.setActiveTool(ToolType.Eraser);
    registerToolManager(tm);
    await waitFor(() => expect(getByTestId('surface').style.cursor).toBe(cursorCss('eraser')));
  });

  it('gives the surface to the VISIBLE view, not whichever mounted or re-ran its effect last', () => {
    // Both canvases stay mounted; only `viewMode` identifies the visible cursor owner.
    const { getByTestId } = render(<TwoHosts />);
    expect(getByTestId('surface-2d').style.cursor).toBe(cursorCss('eraser'));
    expect(getByTestId('surface-3d').style.cursor).toBe('');

    act(() => { setStoreState({ viewMode: '3d' }); });
    expect(getByTestId('surface-3d').style.cursor).toBe(cursorCss('eraser'));
    expect(getByTestId('surface-2d').style.cursor).toBe('');

    // Flipping back hands the cursor to 2D rather than leaving both blank or 3D holding a stale claim.
    act(() => { setStoreState({ viewMode: '2d' }); });
    expect(getByTestId('surface-2d').style.cursor).toBe(cursorCss('eraser'));
    expect(getByTestId('surface-3d').style.cursor).toBe('');
  });
});
