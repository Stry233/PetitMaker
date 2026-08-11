/**
 * The painted region lives in the store (edit slice), not in a shell's local state.
 *
 * It used to be `useState` inside App.tsx, which left four things with nothing to read: the
 * region overlay's cell count, the region panel's count, the generate scope's disabled state and
 * the agent's region guard. This pins the contract those four now share — a consumer that never
 * renders inside App reads the cells and their count straight off the store, and `region.length`
 * IS the count (the brush deduplicates as it paints, so no second field and no scan).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRegionBrush } from '../../ui/shell/use-region-brush';
import { useEditorStore } from '../../state/store';
import { paintRegionCell, finishRegionStroke } from '../../core/runtime/region-brush';
import { createDefaultRegistry } from '../../rules/index';
import { getMapTemplate } from '../../config/maps';
import { getCell, isBuildableZone } from '../../core/model/grid-model';
import type { MacroCoord } from '../../core/model/types';

/** The first `n` buildable cells of a row that has them, so the brush keeps every cell it paints. */
function buildableRun(n: number): MacroCoord[] {
  const state = useEditorStore.getState().gridState!;
  const { width, height } = state.template;
  for (let y = 0; y < height; y++) {
    const row: MacroCoord[] = [];
    for (let x = 0; x < width; x++) {
      const cell = getCell(state.cells, x, y);
      if (cell && isBuildableZone(cell.zone)) row.push({ x, y });
      else row.length = 0;
      if (row.length === n) return row;
    }
  }
  throw new Error('no buildable run on this template');
}

const paint = (cells: MacroCoord[]) => act(() => {
  for (const c of cells) paintRegionCell(c);
  finishRegionStroke();
});

const region = () => useEditorStore.getState().region;

describe('the painted region is store state', () => {
  beforeEach(() => {
    useEditorStore.getState().initMap(getMapTemplate('hexia')!, createDefaultRegistry());
    useEditorStore.setState({ region: [], regionTool: 'brush', regionBrushSize: 1 });
  });

  it('starts empty — [] is the one representation of "whole map"', () => {
    expect(region()).toEqual([]);
    expect(region().length).toBe(0);
  });

  it('a stroke lands in the store, and the count is what was painted', () => {
    const { rerender } = renderHook(() => useRegionBrush(true));
    const cells = buildableRun(5);

    paint(cells);
    rerender();

    expect(region()).toEqual(cells);
    expect(region().length).toBe(5);
  });

  it('repainting a cell does not double-count it', () => {
    const { rerender } = renderHook(() => useRegionBrush(true));
    const cells = buildableRun(5);

    paint(cells);
    rerender();
    paint(cells.slice(0, 3)); // straight back over the start of the same run
    rerender();

    expect(region().length).toBe(5);
  });

  it('clearing empties it, count included', () => {
    const { result, rerender } = renderHook(() => useRegionBrush(true));
    paint(buildableRun(4));
    rerender();
    expect(region().length).toBe(4);

    act(() => { result.current.clearRegion(); });
    rerender();

    expect(region()).toEqual([]);
    expect(region().length).toBe(0);
  });

  it('is readable without rendering anything — the store is the source', () => {
    const cells = buildableRun(3);
    act(() => { useEditorStore.getState().setRegion(cells); });
    expect(useEditorStore.getState().region).toEqual(cells);
  });
});
