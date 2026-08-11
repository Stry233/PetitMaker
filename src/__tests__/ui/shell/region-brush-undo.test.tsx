/**
 * The Generate region brush's OWN undo/redo (ui/shell/use-region-brush.ts), separate from the
 * map's command history: a painted region is a scope for a future generate, not a map edit
 * (see kit/commands.ts, which routes Ctrl+Z here while `selectingRegion` is on).
 * Drives the region-brush channel (core/runtime/region-brush) the hook registers on directly —
 * the same entry points the pointer machine reports through — rather than simulating real
 * pointer drags, to test the stack logic on its own terms.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRegionBrush } from '../../../ui/shell/use-region-brush';
import { useEditorStore } from '../../../state/store';
import { paintRegionCell, finishRegionStroke } from '../../../core/runtime/region-brush';
import type { MacroCoord } from '../../../core/model/types';

function useHarness(selectingRegion: boolean) {
  const region = useEditorStore((s) => s.region);
  const brush = useRegionBrush(selectingRegion);
  return { region, ...brush };
}

const move = (c: MacroCoord) => act(() => paintRegionCell(c));
const done = () => act(() => finishRegionStroke());

describe('region brush — its own undo/redo (separate from map history)', () => {
  beforeEach(() => {
    useEditorStore.setState({ regionTool: 'brush', regionBrushSize: 1, region: [] });
  });

  it('a whole brush drag (many moves) undoes as ONE unit, not one cell', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    // Drag across several cells — several move callbacks, one pointer-up.
    move({ x: 0, y: 0 });
    move({ x: 1, y: 0 });
    move({ x: 2, y: 0 });
    done();
    rerender({ sel: true });
    expect(result.current.region.length).toBe(3); // the stroke committed

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.region).toEqual([]); // the WHOLE drag undone, not one cell
  });

  it('a shape commit (rect drag) undoes as one unit', () => {
    useEditorStore.setState({ regionTool: 'rect' });
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 0, y: 0 }); // sets the anchor
    move({ x: 2, y: 2 }); // drags the preview
    done();               // commits the rect
    rerender({ sel: true });
    expect(result.current.region.length).toBe(9); // 3x3 rect

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.region).toEqual([]);
  });

  it('a 3-click curve gesture undoes as ONE unit (not per click)', () => {
    useEditorStore.setState({ regionTool: 'curve' });
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 0, y: 0 }); done(); // click 1
    move({ x: 2, y: 0 }); done(); // click 2
    move({ x: 1, y: 1 }); done(); // click 3 — commits
    rerender({ sel: true });
    expect(result.current.region.length).toBeGreaterThan(0);

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.region).toEqual([]); // the whole 3-click curve, not one click
  });

  it('Clear is itself undoable', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 5, y: 5 });
    done();
    rerender({ sel: true });
    const painted = result.current.region;
    expect(painted.length).toBeGreaterThan(0);

    act(() => { result.current.clearRegion(); });
    rerender({ sel: true });
    expect(result.current.region).toEqual([]);

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.region).toEqual(painted); // the misclick is recoverable
  });

  it('redo mirrors undo', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 3, y: 3 });
    done();
    rerender({ sel: true });
    const painted = result.current.region;

    act(() => { result.current.regionUndo(); });
    rerender({ sel: true });
    expect(result.current.region).toEqual([]);

    act(() => { result.current.regionRedo(); });
    rerender({ sel: true });
    expect(result.current.region).toEqual(painted);
  });

  it('an empty region-undo stack no-ops (returns false, leaves the region untouched)', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    let ok = true;
    act(() => { ok = result.current.regionUndo(); });
    rerender({ sel: true });
    expect(ok).toBe(false);
    expect(result.current.region).toEqual([]);
  });

  it('leaving region-select mode discards the stack — re-entering cannot undo past it', () => {
    const { result, rerender } = renderHook(({ sel }) => useHarness(sel), { initialProps: { sel: true } });

    move({ x: 7, y: 7 });
    done();
    rerender({ sel: true });
    expect(result.current.region.length).toBeGreaterThan(0);

    // Leave region-select mode (mirrors the scope screen's Done / navigating away), then
    // come back — a fresh session must not inherit a stale undo entry from before.
    rerender({ sel: false });
    rerender({ sel: true });

    let ok = true;
    act(() => { ok = result.current.regionUndo(); });
    rerender({ sel: true });
    expect(ok).toBe(false); // nothing to undo — the earlier stroke's history is gone
  });
});
