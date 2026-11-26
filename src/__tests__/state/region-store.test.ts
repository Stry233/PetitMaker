/**
 * The painted region lives in the store (edit slice), not in a shell's local state.
 *
 * Four consumers read it without rendering inside App: the region overlay's cell count, the region
 * panel's count, the generate scope's disabled state and the agent's region guard. This pins the
 * contract they share: they read the cells and their count straight off the store, and
 * `region.length` is the count (the brush deduplicates as it paints, so no second field and no scan).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { startRegionBrush } from '../../editor/editing/region-brush';
import { useEditorStore } from '../../state/store';
import { regionOf } from '../../state/editing/region';
import { paintRegionCell, finishRegionStroke, clearRegionSelection } from '../../view/interaction/pointer/region-channel';
import { createDefaultRegistry } from '../../rules/index';
import { getMapTemplate } from '../../config/maps';
import { getCell } from '../../core/model/grid-model';
import { isBuildableZone } from '../../core/game/zones';
import type { MacroCoord } from '../../core/model/types';
import { DEFAULT_REGION_REQUEST } from '../../state/editing/vocabulary';

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

const region = () => regionOf(useEditorStore.getState(), 'generator');

describe('the painted region is store state', () => {
  let stop: (() => void) | null = null;
  beforeEach(() => {
    useEditorStore.getState().initMap(getMapTemplate('hexia')!, createDefaultRegistry());
    useEditorStore.setState({ regions: {}, regionTool: 'free', regionBrushSize: 1 });
  });
  afterEach(() => { stop?.(); stop = null; });
  const brush = () => { useEditorStore.getState().setSelectingRegion(true, 'generator'); stop = startRegionBrush(); };

  it('starts empty — [] is the one representation of "whole map"', () => {
    expect(region()).toEqual([]);
    expect(region().length).toBe(0);
  });

  it('a stroke lands in the store, and the count is what was painted', () => {
    brush();
    const cells = buildableRun(5);

    paint(cells);

    expect(region()).toEqual(cells);
    expect(region().length).toBe(5);
  });

  it('repainting a cell does not double-count it', () => {
    brush();
    const cells = buildableRun(5);

    paint(cells);
    paint(cells.slice(0, 3)); // straight back over the start of the same run

    expect(region().length).toBe(5);
  });

  it('clearing empties it, count included', () => {
    brush();
    paint(buildableRun(4));
    expect(region().length).toBe(4);

    act(() => clearRegionSelection());

    expect(region()).toEqual([]);
    expect(region().length).toBe(0);
  });

  it('is readable without rendering anything — the store is the source', () => {
    const cells = buildableRun(3);
    act(() => { useEditorStore.getState().setRegion(cells, 'generator'); });
    expect(regionOf(useEditorStore.getState(), 'generator')).toEqual(cells);
  });
});

describe('the region request', () => {
  it('a brush started with a request paints under it, and ending the brush restores the default', () => {
    const request = { tools: ['free', 'rect'] as const, single: true, minSide: 20 };
    act(() => { useEditorStore.getState().setSelectingRegion(true, 'generator', request); });
    expect(useEditorStore.getState().regionRequest).toEqual(request);
    act(() => { useEditorStore.getState().setSelectingRegion(false); });
    expect(useEditorStore.getState().regionRequest).toEqual(DEFAULT_REGION_REQUEST);
  });
});
