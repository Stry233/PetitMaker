/**
 * The painted region lives in the store (edit slice), not in a shell's local state.
 *
 * Held as `useState` inside App.tsx it leaves four things with nothing to read: the region
 * overlay's cell count, the region panel's count, the generate scope's disabled state and the
 * agent's region guard. This pins the contract those four share — a consumer that never
 * renders inside App reads the cells and their count straight off the store, and `region.length`
 * Is the count (the brush deduplicates as it paints, so no second field and no scan).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { startRegionBrush } from '../../editor/editing/region-brush';
import { useEditorStore } from '../../state/store';
import { paintRegionCell, finishRegionStroke, clearRegionSelection } from '../../tools/pointer/region';
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

const region = () => useEditorStore.getState().region;

describe('the painted region is store state', () => {
  let stop: (() => void) | null = null;
  beforeEach(() => {
    useEditorStore.getState().initMap(getMapTemplate('hexia')!, createDefaultRegistry());
    useEditorStore.setState({ region: [], regionTool: 'free', regionBrushSize: 1 });
  });
  afterEach(() => { stop?.(); stop = null; });
  const brush = () => { stop = startRegionBrush(); };

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
    act(() => { useEditorStore.getState().setRegion(cells); });
    expect(useEditorStore.getState().region).toEqual(cells);
  });
});

describe('the region request', () => {
  it('a release restores the default only while its own request is current', () => {
    const first = { tools: ['free', 'rect'] as const, single: true, minSide: 20 };
    const releaseFirst = useEditorStore.getState().claimRegionRequest(first);
    expect(useEditorStore.getState().regionRequest).toBe(first);
    const second = { ...DEFAULT_REGION_REQUEST, minSide: 8 };
    const releaseSecond = useEditorStore.getState().claimRegionRequest(second);
    releaseFirst();
    expect(useEditorStore.getState().regionRequest).toBe(second);
    releaseSecond();
    expect(useEditorStore.getState().regionRequest).toBe(DEFAULT_REGION_REQUEST);
  });
});
