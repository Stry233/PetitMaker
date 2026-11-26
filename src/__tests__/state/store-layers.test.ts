/**
 * Layer visibility/lock state is per-map: a new or loaded map must not inherit
 * the previous map's locks or hidden layers (the panel would show a lock the
 * rules don't enforce until the next toggle re-syncs).
 *
 * Plus the pin: whether the active layer is where a hand put it. The water brush reads it: when pinned
 * it paints at that layer, otherwise it follows the ground each cell stands on.
 */
import { describe, it, expect } from 'vitest';
import { useEditorStore } from '../../state/store';
import { createDefaultRegistry } from '../../rules/index';
import { makeState, makeTemplate } from '../_support/map-state';
import { applyOptionalSections } from '../../io/import/sections-restore';
import { CommandType, TerrainType } from '../../core/model/types';

describe('store: per-map layer state', () => {
  it('initMap clears layer locks and visibility from the previous map', () => {
    const store = useEditorStore.getState();
    store.initMap(makeTemplate(10, 10), createDefaultRegistry());
    store.setLayerLocked(2, true);
    store.setLayerVisibility(3, false);
    expect(useEditorStore.getState().gridState!.lockedLayers.has(2)).toBe(true);

    store.initMap(makeTemplate(10, 10), createDefaultRegistry());

    const s = useEditorStore.getState();
    expect(s.layerVisibility).toEqual({});
    expect(s.gridState?.lockedLayers.size).toBe(0);
  });
});

describe('store: layer locks live on the map the rules read', () => {
  it('a lock set with no map view mounted reaches the grid the rules read, published as a new set', () => {
    const store = useEditorStore.getState();
    store.initMap(makeTemplate(10, 10), createDefaultRegistry());
    const empty = useEditorStore.getState().gridState!.lockedLayers;
    store.setLayerLocked(1, true);
    expect(useEditorStore.getState().gridState!.lockedLayers).not.toBe(empty);
    store.setLayerLocked(3, true);
    store.setLayerLocked(3, false);
    const { gridState, commandExecutor } = useEditorStore.getState();
    expect([...gridState!.lockedLayers]).toEqual([1]);
    const result = commandExecutor!.execute({ type: CommandType.PaintTerrain, cells: [{ x: 2, y: 2 }], terrainType: TerrainType.Mountain, elevation: 1 });
    expect(result.success).toBe(false);
  });

  it('a loaded map opens with no locks', () => {
    useEditorStore.getState().setLayerLocked(2, true);
    const loaded = makeState(10, 10);
    loaded.lockedLayers = new Set([2]);
    useEditorStore.getState().loadMap(loaded, createDefaultRegistry());
    expect(useEditorStore.getState().gridState!.lockedLayers.size).toBe(0);
  });

  it('a restored session section locks the grid the export then reads', () => {
    const store = useEditorStore.getState();
    store.initMap(makeTemplate(10, 10), createDefaultRegistry());
    const { gridState, commandExecutor, setLayerLocked } = useEditorStore.getState();
    applyOptionalSections({ session: { v: 1, lockedLayers: [2, 4] } }, {
      executor: commandExecutor, state: gridState!, setLayerLocked, setCamera: () => {},
    });
    expect([...useEditorStore.getState().gridState!.lockedLayers].sort()).toEqual([2, 4]);
  });
});

