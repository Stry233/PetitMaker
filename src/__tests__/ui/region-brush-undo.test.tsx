/**
 * The Generate region brush's OWN undo/redo (ui/hooks/useRegionBrush.ts), separate from the
 * map's command history: a painted region is a scope for a future generate, not a map edit
 * (see ui/keybindings/commands.ts, which routes Ctrl+Z here while `selectingRegion` is on).
 * Drives the window-bridge callbacks (__petitRegionBrushCallback/Done) the hook installs
 * directly — the same entry points PixiCanvas calls on pointer move/up — rather than
 * simulating real pointer drags, to test the stack logic on its own terms.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useRegionBrush } from '../../ui/hooks/useRegionBrush';
import { useEditorStore } from '../../state/store';
import { petitWindow } from '../../core/runtime/window-bridge';
import type { MacroCoord } from '../../core/model/types';

function useHarness(selectingRegion: boolean) {
  const [genRegion, setGenRegion] = useState<MacroCoord[]>([]);
  const brush = useRegionBrush(selectingRegion, genRegion, setGenRegion);
  return { genRegion, setGenRegion, ...brush };
}

const win = () => petitWindow();
const move = (c: MacroCoord) => act(() => win().__petitRegionBrushCallback?.(c));
const done = () => act(() => win().__petitRegionBrushDone?.());

describe('region brush — its own undo/redo (separate from map history)', () => {
  beforeEach(() => {
    useEditorStore.setState({ regionTool: 'brush', regionBrushSize: 1 });
  });

  it('a whole brush drag (many moves) undoes as ONE unit, not one cell', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    // Drag across several cells — several move callbacks, one pointer-up.
    move({ x: 0, y: 0 });
    move({ x: 1, y: 0 });
    move({ x: 2, y: 0 });
    done();
    rerender({ sel: true });
    expect(result.current.genRegion.length).toBe(3); // the stroke committed

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.genRegion).toEqual([]); // the WHOLE drag undone, not one cell
  });

  it('a shape commit (rect drag) undoes as one unit', () => {
    useEditorStore.setState({ regionTool: 'rect' });
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 0, y: 0 }); // sets the anchor
    move({ x: 2, y: 2 }); // drags the preview
    done();               // commits the rect
    rerender({ sel: true });
    expect(result.current.genRegion.length).toBe(9); // 3x3 rect

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.genRegion).toEqual([]);
  });

  it('a 3-click curve gesture undoes as ONE unit (not per click)', () => {
    useEditorStore.setState({ regionTool: 'curve' });
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 0, y: 0 }); done(); // click 1
    move({ x: 2, y: 0 }); done(); // click 2
    move({ x: 1, y: 1 }); done(); // click 3 — commits
    rerender({ sel: true });
    expect(result.current.genRegion.length).toBeGreaterThan(0);

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.genRegion).toEqual([]); // the whole 3-click curve, not one click
  });

  it('Clear is itself undoable', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 5, y: 5 });
    done();
    rerender({ sel: true });
    const painted = result.current.genRegion;
    expect(painted.length).toBeGreaterThan(0);

    act(() => { result.current.clearRegion(); });
    rerender({ sel: true });
    expect(result.current.genRegion).toEqual([]);

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.genRegion).toEqual(painted); // the misclick is recoverable
  });

  it('redo mirrors undo', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 3, y: 3 });
    done();
    rerender({ sel: true });
    const painted = result.current.genRegion;

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.genRegion).toEqual([]);

    act(() => { result.current.regionRedo(); });
    rerender({ sel: true });
    expect(result.current.genRegion).toEqual(painted);
  });

  it('an empty region-undo stack no-ops (returns false, leaves genRegion untouched)', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    let ok = true;
    act(() => { ok = result.current.regionUndo(); });
    rerender({ sel: true });
    expect(ok).toBe(false);
    expect(result.current.genRegion).toEqual([]);
  });

  it('leaving region-select mode discards the stack — re-entering cannot undo past it', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 7, y: 7 });
    done();
    rerender({ sel: true });
    expect(result.current.genRegion.length).toBeGreaterThan(0);

    // Leave region-select mode (mirrors RegionSelectPanel's Done / navigating away), then
    // come back — a fresh session must not inherit a stale undo entry from before.
    rerender({ sel: false });
    rerender({ sel: true });

    let ok = true;
    act(() => { ok = result.current.regionUndo(); });
    rerender({ sel: true });
    expect(ok).toBe(false); // nothing to undo — the earlier stroke's history is gone
  });
});
