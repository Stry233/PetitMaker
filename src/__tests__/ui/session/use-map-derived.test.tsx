// @vitest-environment jsdom
/** A value derived from a map edited in place follows the map's revision and its own dependencies,
 *  and a settled revision waits out a run of edits. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { CommandType, TerrainType } from '../../../core/model/types';
import { useMapDerived, useSettledRevision } from '../../../ui/session/use-map-derived';

function paint(): void {
  const executor = useEditorStore.getState().commandExecutor!;
  const start = executor.beginStroke();
  executor.execute({ type: CommandType.PaintTerrain, cells: [{ x: 60, y: 60 }], terrainType: TerrainType.Mountain, elevation: 1 });
  start.commit();
}

describe('useMapDerived', () => {
  beforeEach(() => { localStorage.clear(); newMap(editorPort, 'hexia'); });
  afterEach(() => { vi.useRealTimers(); });

  it('recomputes after an in-place edit of the live map, and not on a plain re-render', () => {
    const compute = vi.fn(() => ({}));
    const { result, rerender } = renderHook(({ k }) => useMapDerived(compute, [k]), { initialProps: { k: 1 } });
    const first = result.current;
    rerender({ k: 1 });
    expect(result.current).toBe(first);
    act(() => { paint(); });
    expect(result.current).not.toBe(first);
    const edited = result.current;
    rerender({ k: 2 });
    expect(result.current).not.toBe(edited);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it('follows a given grid by its revision as of the render', () => {
    const grid = useEditorStore.getState().gridState!;
    const compute = vi.fn(() => ({}));
    const { result, rerender } = renderHook(() => useMapDerived(compute, [], { grid }));
    const first = result.current;
    act(() => { paint(); });
    expect(result.current).toBe(first);
    rerender();
    expect(result.current).not.toBe(first);
  });

  it('settles a revision once edits have been quiet', () => {
    vi.useFakeTimers();
    const grid = useEditorStore.getState().gridState!;
    const { result, rerender } = renderHook(() => useSettledRevision(grid, 400));
    const before = result.current;
    act(() => { paint(); });
    rerender();
    expect(result.current).toBe(before);
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).not.toBe(before);
  });
});
