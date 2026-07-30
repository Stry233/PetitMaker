/**
 * Layer visibility/lock state is per-map: a new or loaded map must not inherit
 * the previous map's locks or hidden layers (the panel would show a lock the
 * rules don't enforce until the next toggle re-syncs).
 */
import { describe, it, expect } from 'vitest';
import { useEditorStore } from '../../state/store';
import { createDefaultRegistry } from '../../rules/index';
import { makeTemplate } from '../rules/_helpers';

describe('store: per-map layer state', () => {
  it('initMap clears layer locks and visibility from the previous map', () => {
    const store = useEditorStore.getState();
    store.setLayerLocked(2, true);
    store.setLayerVisibility(3, false);
    expect(useEditorStore.getState().layerLocked[2]).toBe(true);

    store.initMap(makeTemplate(10, 10), createDefaultRegistry());

    const s = useEditorStore.getState();
    expect(s.layerLocked).toEqual({});
    expect(s.layerVisibility).toEqual({});
    expect(s.gridState?.lockedLayers.size).toBe(0);
  });
});
