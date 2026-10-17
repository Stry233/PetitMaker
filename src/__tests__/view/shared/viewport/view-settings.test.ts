/** The grid the map draws: one grid for the object and terrain choices, none when off, and under
 *  the automatic choice the grid the active tool's cells lie on. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../../state/store';
import type { EditModeChange } from '../../../../state/editing/edit-mode';
import { shownGridOf } from '../../../../view/shared/viewport/view-settings';
import { GRID_MODES } from '../../../../platform/storage/prefs';
import { resetStore, setStoreState } from '../../../_support/store';
import { armingOf } from '../../../../state/editing/arming';
import { Viewport } from '../../../../view/map2d/camera/viewport';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { resolvePointer } from '../../../../tools/pointer/runtime/pointer';
import type { ToolContext } from '../../../../tools/pointer/runtime/types';
import { gridCellRect } from '../../../../core/grid/grids';
import { GRIDS } from '../../../../core/game/profile';

beforeEach(resetStore);

const arm = (change: EditModeChange | null): void => {
  if (change) useEditorStore.getState().setEditMode(change);
};

/** Each tool the bar arms, and the grid its cells lie on. */
const TOOLS: [string, EditModeChange | null, 'object' | 'terrain'][] = [
  ['the Hand', null, 'object'],
  ['the mountain brush', { mode: 'mountain', arm: { kind: 'brush' } }, 'terrain'],
  ['a water shape', { mode: 'water', arm: { kind: 'shape', shape: 'line' } }, 'terrain'],
  ['the mountain eraser', { mode: 'mountain', arm: { kind: 'erase' } }, 'terrain'],
  ['the mountain rise', { mode: 'mountain', arm: { kind: 'smart', macro: 'raise' } }, 'terrain'],
  ['the road brush', { mode: 'road', arm: { kind: 'brush' } }, 'object'],
  ['the road eraser', { mode: 'road', arm: { kind: 'erase' } }, 'object'],
  ['the road link', { mode: 'road', arm: { kind: 'smart', macro: 'road-link' } }, 'object'],
  ['the edge cut', { mode: 'road', arm: { kind: 'trim' } }, 'object'],
  ['the object shelf', { mode: 'object' }, 'object'],
  ['the notes', { mode: 'annotate' }, 'object'],
];

describe('the automatic grid follows the active tool', () => {
  it.each(TOOLS)('%s shows the %s grid', (_name, change, grid) => {
    setStoreState({ gridMode: 'auto' });
    arm(change);
    expect(shownGridOf(useEditorStore.getState())).toBe(grid);
  });

  it('moves back to the object grid when a terrain brush is put down', () => {
    setStoreState({ gridMode: 'auto' });
    arm({ mode: 'water', arm: { kind: 'brush' } });
    expect(shownGridOf(useEditorStore.getState())).toBe('terrain');
    arm({ mode: 'object' });
    expect(shownGridOf(useEditorStore.getState())).toBe('object');
  });
});

describe('a fixed choice ignores the tool', () => {
  it.each(TOOLS)('under %s', (_name, change) => {
    arm(change);
    setStoreState({ gridMode: 'object' });
    expect(shownGridOf(useEditorStore.getState())).toBe('object');
    setStoreState({ gridMode: 'terrain' });
    expect(shownGridOf(useEditorStore.getState())).toBe('terrain');
    setStoreState({ gridMode: 'off' });
    expect(shownGridOf(useEditorStore.getState())).toBeNull();
  });

  it('every choice is one of the four', () => {
    expect([...GRID_MODES]).toEqual(['auto', 'object', 'terrain', 'off']);
  });
});

describe('the shown grid moves the lines, never the pen', () => {
  /** The cell the mountain brush lands on at each of a lattice of screen points. */
  function landings(): { cell: { x: number; y: number }; grid: string }[] {
    const view = new Viewport(800, 600);
    view.setZoom(0.37, 0, 0);
    view.pan(-13.3, -7.9);
    const tool = new DrawingTool();
    const ctx = { arming: armingOf(useEditorStore.getState()) } as ToolContext;
    const out: { cell: { x: number; y: number }; grid: string }[] = [];
    for (let sy = 7; sy < 600; sy += 23) for (let sx = 5; sx < 800; sx += 29) {
      const { cell, grid } = resolvePointer({ projection: view }, tool, ctx, sx, sy);
      out.push({ cell: { x: cell.x, y: cell.y }, grid });
    }
    return out;
  }

  it('the mountain brush lands on the same terrain cells under every grid choice', () => {
    arm({ mode: 'mountain', arm: { kind: 'brush' } });
    setStoreState({ gridMode: 'object' });
    const before = landings();
    expect(before.every((l) => l.grid === 'terrain')).toBe(true);
    for (const mode of GRID_MODES) {
      setStoreState({ gridMode: mode });
      expect(landings()).toEqual(before);
    }
  });

  it('under the automatic grid each cell the brush lands on is one whole cell of the drawn grid', () => {
    setStoreState({ gridMode: 'auto' });
    arm({ mode: 'water', arm: { kind: 'brush' } });
    const shown = shownGridOf(useEditorStore.getState())!;
    expect(shown).toBe('terrain');
    const lines = GRIDS[shown].offset;
    // The object grid's lines would cut every one of these cells through the middle.
    expect(Number.isInteger(lines.x - GRIDS.object.offset.x)).toBe(false);
    for (const { cell, grid } of landings()) {
      const rect = gridCellRect(GRIDS[grid as 'terrain'], cell);
      expect([rect.w, rect.h]).toEqual([1, 1]);
      expect(Number.isInteger(rect.x - lines.x) && Number.isInteger(rect.y - lines.y)).toBe(true);
    }
  });
});
