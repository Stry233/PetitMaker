/**
 * Layer visibility/lock state is per-map: a new or loaded map must not inherit
 * the previous map's locks or hidden layers (the panel would show a lock the
 * rules don't enforce until the next toggle re-syncs).
 *
 * Plus the pin: whether the active layer is where a hand put it. The water brush reads it — pinned
 * it paints at that layer, automatic it follows the ground each cell stands on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
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

describe('store: the layer pin', () => {
  // The store is a singleton across this file, and the pin is a toggle: a test that inherited a
  // pinned layer from its neighbour would read its own first press as the release.
  beforeEach(() => { useEditorStore.setState({ activeLayer: 0, layerPinned: false }); });

  it('a fresh map opens automatic — nobody has chosen a layer yet', () => {
    useEditorStore.getState().selectLayer(4);
    useEditorStore.getState().initMap(makeTemplate(10, 10), createDefaultRegistry());
    expect(useEditorStore.getState().layerPinned).toBe(false);
    expect(useEditorStore.getState().activeLayer).toBe(0);
  });

  it('a LOADED map arrives automatic too: a pin never crosses from the map being left', () => {
    useEditorStore.getState().selectLayer(4);
    useEditorStore.getState().loadMap(makeState(10, 10), createDefaultRegistry());
    const s = useEditorStore.getState();
    expect(s.layerPinned, 'the previous session must not steer this map\'s water brush').toBe(false);
    expect(s.activeLayer).toBe(0);
  });

  it('a layer ROW press pins that layer', () => {
    useEditorStore.getState().selectLayer(3);
    expect(useEditorStore.getState()).toMatchObject({ activeLayer: 3, layerPinned: true });
  });

  it('pressing the pinned layer again lets go of it: the reset back to automatic', () => {
    useEditorStore.getState().selectLayer(3);
    useEditorStore.getState().selectLayer(3);
    const s = useEditorStore.getState();
    expect(s.layerPinned, 'automatic again').toBe(false);
    expect(s.activeLayer, 'the floor stays where it was — only the pin let go').toBe(3);
  });

  it('pressing a DIFFERENT row pins the new one rather than releasing', () => {
    useEditorStore.getState().selectLayer(3);
    useEditorStore.getState().selectLayer(5);
    expect(useEditorStore.getState()).toMatchObject({ activeLayer: 5, layerPinned: true });
  });

  // The rail's steppers and the layer.up/down commands come through here, and each is a hand.
  it('setActiveLayer pins too, and stays pinned when it clamps to the layer it is already on', () => {
    useEditorStore.getState().setActiveLayer(2);
    expect(useEditorStore.getState().layerPinned).toBe(true);
    useEditorStore.getState().setActiveLayer(2);
    expect(useEditorStore.getState().layerPinned, 'a stepper at its limit must not unpin').toBe(true);
  });
});
