/**
 * `shell.ts`'s `setContextMenu`/`setDeletePopover` refuse to open either surface while
 * `tourRunning` is true (both sit far above the tour's z-index and would paint over it), but never
 * refuse to close one: whatever was open when the tour started still has to go away, and both
 * work again once the tour ends.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { makeState, setTerrain } from '../_support/map-state';
import { createDefaultRegistry } from '../../rules';
import { TerrainType } from '../../core/model/types';

const ref = { kind: 'terrain', x: 1, y: 1 } as const;

// Both surfaces stand over a map that holds their target: a mountain cell.
beforeEach(() => {
  const state = makeState(8, 8);
  setTerrain(state, 1, 1, TerrainType.Mountain, 1);
  useEditorStore.getState().loadMap(state, createDefaultRegistry());
});

afterEach(() => {
  useEditorStore.getState().setTourRunning(false);
  useEditorStore.getState().setContextMenu(null);
  useEditorStore.getState().setDeletePopover(null);
});

describe('the tour gates the context menu and the delete popover', () => {
  it('neither opens while the tour runs, though closing one still works', () => {
    const s = useEditorStore.getState();
    s.setContextMenu({ x: 10, y: 10, target: ref, mode: 'pc' });
    s.setDeletePopover(ref);
    s.setTourRunning(true);

    useEditorStore.getState().setContextMenu(null);
    useEditorStore.getState().setDeletePopover(null);
    useEditorStore.getState().setContextMenu({ x: 10, y: 10, target: ref, mode: 'pc' });
    useEditorStore.getState().setDeletePopover(ref);
    expect(useEditorStore.getState().contextMenu).toBeNull();
    expect(useEditorStore.getState().deletePopover).toBeNull();
  });

  it('both open again once the tour ends', () => {
    useEditorStore.getState().setTourRunning(false);
    useEditorStore.getState().setContextMenu({ x: 10, y: 10, target: ref, mode: 'pc' });
    useEditorStore.getState().setDeletePopover(ref);
    expect(useEditorStore.getState().contextMenu).not.toBeNull();
    expect(useEditorStore.getState().deletePopover).not.toBeNull();
  });
});
